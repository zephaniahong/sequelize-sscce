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

  const sequelize = createSequelizeInstance({
    logQueryParameters: true,
    benchmark: true,
    define: {
      timestamps: false // For less clutter in the SSCCE
    }
  });

  async function singleTest() {

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
    const t1Jan = await User.findByPk(user.id, {
      lock: t1.LOCK.SHARE,
      transaction: t1
    });

    const t2 = await sequelize.transaction({
      isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED
    });

    await Promise.all([
      (async () => {
        const t2Jan = await User.findByPk(user.id, {
          transaction: t2
        });

        t2FindSpy();

        await t2Jan.update({ awesome: false }, { transaction: t2 });
        t2UpdateSpy();

        await t2.commit();
      })(),
      (async () => {
        await t1Jan.update({ awesome: true }, { transaction: t1 });
        await delay(2000);
        t1CommitSpy();
        await t1.commit();
      })()
    ]);

    // (t2) find call should have returned before (t1) commit
    expect(t2FindSpy).to.have.been.calledBefore(t1CommitSpy);

    // But (t2) update call should not happen before (t1) commit
    expect(t2UpdateSpy).to.have.been.calledAfter(t1CommitSpy);

  }

  for (let i = 0; i < 20; i++) {
    console.log('### TEST ' + i);

    await singleTest();

    await delay(2000);
  }
};
