'use strict';

// Require the necessary things from Sequelize
const { Sequelize, Op, Model, DataTypes } = require('sequelize');

// This function should be used instead of `new Sequelize()`.
// It applies the config for your SSCCE to work on CI.
const createSequelizeInstance = require('./utils/create-sequelize-instance');

// This is an utility logger that should be preferred over `console.log()`.
const log = require('./utils/log');

// You can use sinon and chai assertions directly in your SSCCE if you want.
const sinon = require('sinon');
const { expect } = require('chai');

// Your SSCCE goes inside this function.
module.exports = async function() {
  const sequelize = createSequelizeInstance({
    logQueryParameters: true,
    benchmark: true,
    define: {
      timestamps: false // For less clutter in the SSCCE
    }
  });

  const User = sequelize.define('user', {
    username: Support.Sequelize.STRING,
    awesome: Support.Sequelize.BOOLEAN
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
};
