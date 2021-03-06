'use strict';

// Require the necessary things from Sequelize
const { Sequelize, Op, Model, DataTypes, Transaction } = require('sequelize');

// This function should be used instead of `new Sequelize()`.
// It applies the config for your SSCCE to work on CI.
const createSequelizeInstance = require('./utils/create-sequelize-instance');

// This is an utility logger that should be preferred over `console.log()`.
const log = require('./utils/log');

// You can use sinon and chai assertions directly in your SSCCE if you want.
const sinon = require('sinon');
const { expect } = require('chai');

const delay = ms => new Promise(r => setTimeout(r, ms));

// Your SSCCE goes inside this function.
module.exports = async function() {
  if (process.env.DIALECT !== "mysql" && process.env.DIALECT !== "mariadb") return;

  console.log('CRAZY_DEADLOCK_TESTING_A ', !!process.env.CRAZY_DEADLOCK_TESTING_A);
  console.log('CRAZY_DEADLOCK_TESTING_B ', !!process.env.CRAZY_DEADLOCK_TESTING_B);
  console.log('CRAZY_DEADLOCK_TESTING_C ', !!process.env.CRAZY_DEADLOCK_TESTING_C);
  console.log('CRAZY_DEADLOCK_TESTING_R1', !!process.env.CRAZY_DEADLOCK_TESTING_R1);
  console.log('CRAZY_DEADLOCK_TESTING_R2', !!process.env.CRAZY_DEADLOCK_TESTING_R2);

  const sequelize = createSequelizeInstance({
    logQueryParameters: true,
    benchmark: true,
    define: {
      timestamps: false // For less clutter in the SSCCE
    }
  });

  async function mainTest() {
    const User = sequelize.define('user', {
      username: DataTypes.STRING,
      awesome: DataTypes.BOOLEAN
    }, { timestamps: false });

    const t1CommitSpy = sinon.spy();
    const t2FindSpy = sinon.spy();
    const t2UpdateSpy = sinon.spy();

    await sequelize.sync({ force: true });
    const user = await User.create({ username: 'jan' });

    const t1 = await sequelize.transaction();

    // Set a shared mode lock on the row.
    // Other sessions can read the row, but cannot modify it until t1 commits.
    // https://dev.mysql.com/doc/refman/5.7/en/innodb-locking-reads.html
    const t1Jan = await User.findByPk(user.id, {
      lock: t1.LOCK.SHARE,
      transaction: t1
    });

    const t2 = await sequelize.transaction({
      isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED
    });

    await Promise.all([
      (async () => {
        // Started (passing): 60    (A)
        // Finished (passing): 62   (C)
        // Started (failing): 60    (A)
        // Finished (failing): 62   (C)
        const t2Jan = await User.findByPk(user.id, {
          transaction: t2
        });

        t2FindSpy();

        // Started (passing): 65    (D)
        // Finished (passing): 70   (G)
        // Started (failing): 65    (D)
        // Finished (failing): WOULD RUN BUT DEADLOCK
        await t2Jan.update({ awesome: false }, { transaction: t2 });
        t2UpdateSpy();

        // Started (passing): 71    (H)
        // Finished (passing): 76   (J)
        // Started (failing): ??    (?)
        // Finished (failing): ??   (?)
        await t2.commit();
      })(),
      (async () => {
        // Started (passing): 61    (B)
        // Finished (passing): 66   (E)
        // Started (failing): 61    (B)
        // Finished (failing): 66   (E)
        await t1Jan.update({ awesome: true }, { transaction: t1 });
        await delay(500);
        t1CommitSpy();

        // Started (passing): 69    (F)
        // Finished (passing): 74   (I)
        // Started (failing): ??    (?)
        // Finished (failing): ??   (?)
        await t1.commit();
      })()
    ]);

    // (t2) find call should have returned before (t1) commit
    expect(t2FindSpy).to.have.been.calledBefore(t1CommitSpy);

    // But (t2) update call should not happen before (t1) commit
    expect(t2UpdateSpy).to.have.been.calledAfter(t1CommitSpy);
  }

  async function simplifiedTest() {
    const User = sequelize.define('user', {
      username: DataTypes.STRING,
      awesome: DataTypes.BOOLEAN
    }, { timestamps: false });

    await sequelize.sync({ force: true });
    const { id } = await User.create({ username: 'jan' });
    const t1 = await sequelize.transaction();

    // Set a shared mode lock on the row.
    // Other sessions can read the row, but cannot modify it until t1 commits.
    // https://dev.mysql.com/doc/refman/5.7/en/innodb-locking-reads.html
    const t1Jan = await User.findByPk(id, {
      lock: t1.LOCK.SHARE,
      transaction: t1
    });

    const t2 = await sequelize.transaction({
      isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED
    });

    const t2Jan = await User.findByPk(id, { transaction: t2 });

    const executionOrder = [];

    function executed(info) {
      executionOrder.push(info);
      console.log(info);
    }

    let stop = false;
    let committingT1 = false;
    let committingT2 = false;

    try {
      await Promise.all([
        (async () => {
          try {
            executed('Send update query with t2');
            await t2Jan.update({ awesome: false }, { transaction: t2 });
            executed('Update query with t2 done');
            executed('Send commit query with t2');
            committingT2 = true;
            await t2.commit();
            executed('Commit query with t2 done');
          } finally {
            stop = true;
          }
        })(),
        (async () => {
          await delay(500);
          if (stop) return;

          executed('Send query to do something with t1');
          await t1Jan.update({ awesome: true }, { transaction: t1 });
          executed('Query to do something with t1 done');

          await delay(500);
          if (stop) return;

          executed('Send commit query with t1');
          committingT1 = true;
          await t1.commit();
          executed('Commit query with t1 done');
        })()
      ]);
    } catch (error) {
      // eslint-disable-next-line no-inner-declarations
      async function tryRollback(t) {
        try {
          await t.rollback();
        } catch (error) {
          console.log('suppressing error upon rollback attempt:', error);
          // if (error.message.includes('Transaction cannot be rolled back because it has been finished with state:')) {
          //   // Suppress
          // } else {
          //   throw error;
          // }
        }
      }

      await tryRollback(t1);
      await tryRollback(t2);

      console.log('rethrowing after rollbacks');
      throw error;
    }

    expect(executionOrder).to.deep.equal([
      'Send update query with t2',
      'Send query to do something with t1',
      'Query to do something with t1 done',
      'Send commit query with t1',
      'Commit query with t1 done',
      'Update query with t2 done'
    ]);
  }

  async function causeDeadlock() {
    const User = sequelize.define('user', {
      username: DataTypes.STRING,
      awesome: DataTypes.BOOLEAN
    }, { timestamps: false });

    await sequelize.sync({ force: true });
    const { id } = await User.create({ username: 'jan' });
    const t1 = await sequelize.transaction();

    // Set a shared mode lock on the row.
    // Other sessions can read the row, but cannot modify it until t1 commits.
    // https://dev.mysql.com/doc/refman/5.7/en/innodb-locking-reads.html
    const t1Jan = await User.findByPk(id, { lock: t1.LOCK.SHARE, transaction: t1 });
    const t2 = await sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED });
    const t2Jan = await User.findByPk(id, { transaction: t2 });

    let stop = false;

    const executionHistory = [];

    try {
      executionHistory.push('a1');
      await Promise.all([
        (async () => {
          try {
            executionHistory.push('a2');
            await t2Jan.update({ awesome: false }, { transaction: t2 });
            executionHistory.push('a3');
            await t2.commit();
            executionHistory.push('a4');
          } finally {
            executionHistory.push('a5');
            stop = true;
          }
        })(),
        (async () => {
          executionHistory.push('a6');
          await delay(500);
          executionHistory.push('a7');
          if (stop) return;
          executionHistory.push('a8');

          await t1Jan.update({ awesome: true }, { transaction: t1 });
          executionHistory.push('a9');

          await delay(500);
          executionHistory.push('a10');
          if (stop) return;
          executionHistory.push('a11');

          await t1.commit();
          executionHistory.push('a12');
        })()
      ]);
      executionHistory.push('a13');
      console.log('EXECUTION HISTORY:', executionHistory.join(' '));
    } catch (error) {
      console.log('EXECUTION HISTORY:', executionHistory.join(' '));
      await delay(2000);
      console.log('EXECUTION HISTORY:', executionHistory.join(' '));
      console.log('caughterror', error);
      if (process.env.CRAZY_DEADLOCK_TESTING_R1) {
        try {
          await t1.rollback();
        } catch (t1rollbackerror) {
          console.log(`t1rollbackerror (${t1rollbackerror.name})`, t1rollbackerror);
        }
      }
      if (process.env.CRAZY_DEADLOCK_TESTING_R2) {
        try {
          await t2.rollback();
        } catch (_) {} // eslint-disable-line no-empty
      }
      throw error;
    }
  }

  console.log('see here', await sequelize.query("SHOW VARIABLES LIKE 'connect_timeout'"));

  for (let i = 0; i < 20; i++) {
    console.log('### TEST ' + i);

    let errorMessage = "n0thing h4ppen3d";

    let time = Date.now();

    console.log('[[[starting causeDeadlock()]]]');

    try {
      await causeDeadlock();
      time = Date.now() - time;
      console.log(`[[[succeeded in ${time}ms]]]`);
    } catch (error) {
      time = Date.now() - time;
      errorMessage = error.message;
      console.log(`[[[errored in ${time}ms]]] Error name: ${error.name} || Error message: ${error.message} ~~`);
    }

    expect(errorMessage).to.equal('Deadlock found when trying to get lock; try restarting transaction');

    await delay(10);
  }
};
