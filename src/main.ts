import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody:true preserves the unparsed request body so the trading ServiceTokenGuard
  // can verify the inbound HMAC over the exact bytes Laravel signed. Existing routes
  // keep parsing JSON as before — this only adds req.rawBody alongside.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );

  const port = process.env.PORT || 3500;
  await app.listen(port);
  console.log(`[App] EXBT wallet service listening on port ${port}`);
}

bootstrap();
