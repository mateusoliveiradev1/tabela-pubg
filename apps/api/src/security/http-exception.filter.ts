import { randomBytes } from "node:crypto";
import { type ArgumentsHost, Catch, HttpException } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

const codes: Record<number, string> = {
  400: "INVALID_REQUEST",
  401: "AUTHENTICATION_REQUIRED",
  403: "ACCESS_DENIED",
  404: "RESOURCE_NOT_FOUND",
  413: "PAYLOAD_TOO_LARGE",
  428: "REAUTHENTICATION_REQUIRED",
  429: "RATE_LIMITED",
};

@Catch()
export class HttpExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const statusCode = exception instanceof HttpException ? exception.getStatus() : 503;
    const supportCode = `SUP-${randomBytes(6).toString("hex").toUpperCase()}`;
    request.log.error(
      {
        supportCode,
        statusCode,
        exceptionType: exception instanceof Error ? exception.name : "UnknownError",
      },
      "request failed",
    );
    void reply.status(statusCode).send({
      statusCode,
      code: codes[statusCode] ?? "SERVICE_UNAVAILABLE",
      supportCode,
    });
  }
}
