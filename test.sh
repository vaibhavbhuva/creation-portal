#!/bin/sh

whoami
mkdir -p /tmp/logs
cd src/app/client/
npm install -g @angular/cli > /tmp/logs/build.log
npm install >> /tmp/logs/build.log
ng lint >> /tmp/logs/build.log
ng build --prod >> /tmp/logs/build.log
npm run test-coverage | tee /tmp/logs/test_cases.log
