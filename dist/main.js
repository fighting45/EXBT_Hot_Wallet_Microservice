"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.useGlobalPipes(new common_1.ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
    const port = process.env.PORT || 3500;
    await app.listen(port);
    console.log(`[App] EXBT wallet service listening on port ${port}`);
}
bootstrap();
//# sourceMappingURL=main.js.map