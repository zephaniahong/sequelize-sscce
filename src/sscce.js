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
  
  await sequelize.query(`CREATE EXTENSION IF NOT EXISTS "postgis"`);

  const Foo = sequelize.define('Foo', { point: DataTypes.GEOMETRY });
  
  const point = { type: 'Point', coordinates: [39.807222, -76.984722] };
  
  await sequelize.sync();

  log(await Foo.create({ point }));

  log(await Foo.findOne());
};
