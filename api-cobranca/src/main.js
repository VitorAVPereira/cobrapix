"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.enableShutdownHooks();
    const config = app.get(config_1.ConfigService);
    const port = config.get('PORT', 3001);
    await app.listen(port);
    common_1.Logger.log(`API escutando em http://localhost:${port}`, 'Bootstrap');
}
void bootstrap();
//# sourceMappingURL=main.js.map