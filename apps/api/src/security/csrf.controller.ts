import { Controller, Get, Inject, Req, Res, SetMetadata } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { CsrfService } from "./csrf.service.js";

@Controller("security")
export class CsrfController {
  constructor(@Inject(CsrfService) private readonly csrf: CsrfService) {}

  @Get("csrf")
  @SetMetadata("auth.public", true)
  acquire(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): { csrfToken: string } {
    reply.header("cache-control", "no-store");
    return this.csrf.acquire(request, reply);
  }
}
