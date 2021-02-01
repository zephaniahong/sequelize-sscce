#!/bin/bash -c

if [ "$CI_COMBINATION" = "v6 with TS" ]; then
  npm i;
else
  if [ $CI_COMBINATION = "v5" ]; then
    npm i --save sequelize@^5;
  fi
  npm i --production; # Install faster
fi

if [ "$FLAKY_CASE" = "a" ]; then
  echo 'flaky case a'
  npm i --save https://github.com/sequelize/sequelize/tarball/f841f1c7f48bacfe299053767bb5524574de809f;
else
  if [ $FLAKY_CASE = "b" ]; then
    echo 'flaky case b'
    npm i --save https://github.com/sequelize/sequelize/tarball/253cda0167301c70de7485d713c820cbb7a37624;
  else
    echo 'flaky case c'
    npm i --save https://github.com/sequelize/sequelize/tarball/36510e7aaf62b1dc45f96ea3bfc4007b031917dd;
  fi
fi

if [ "$DIALECT" = "postgres" ]; then
  npm i pg@^7 pg-hstore@^2 pg-types@^2;
elif [ "$DIALECT" = "postgres-native" ]; then
  npm i pg@^7 pg-hstore@^2 pg-types@^2 pg-native;
elif [ "$DIALECT" = "mysql" ]; then
  npm i mysql2@^1;
elif [ "$DIALECT" = "mariadb" ]; then
  npm i mariadb@^2;
elif [ "$DIALECT" = "sqlite" ]; then
  npm i sqlite3@^4;
elif [ "$DIALECT" = "mssql" ]; then
  npm i tedious@^6
fi

if [ "$CI_COMBINATION" = "v6 with TS" ]; then
  npm run ts-prep;
fi
