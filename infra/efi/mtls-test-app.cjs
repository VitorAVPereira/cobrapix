'use strict';
require('reflect-metadata');
const { Controller, Post, UseGuards, Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { ConfigModule } = require('@nestjs/config');
const { EfiMtlsGuard } = require('./dist/efi-onboarding/efi-mtls.guard');
class ProbeController {
  probe() { return { verified: true }; }
}
Controller('webhooks/efi')(ProbeController);
for (const route of ['account-opening', 'pix']) {
  Object.defineProperty(ProbeController.prototype, route, { value: function () { return { verified: true }; }, configurable: true });
  const descriptor = Object.getOwnPropertyDescriptor(ProbeController.prototype, route);
  Post(route)(ProbeController.prototype, route, descriptor);
  UseGuards(EfiMtlsGuard)(ProbeController.prototype, route, descriptor);
}
class ProbeModule {}
Module({ imports: [ConfigModule.forRoot({ignoreEnvFile:true})], controllers: [ProbeController], providers: [EfiMtlsGuard] })(ProbeModule);
NestFactory.create(ProbeModule, {logger:['error']}).then(app => app.listen(3001,'0.0.0.0'));
