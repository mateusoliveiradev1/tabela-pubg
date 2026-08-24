import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import type { HealthResponse } from "@pubg-camp/contracts";
import { Public } from "../authorization/decorators.js";
import { HealthService } from "./health.service.js";

@Controller("health")
@Public()
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get("live")
  live(): HealthResponse {
    return this.health.live();
  }

  @Get("ready")
  async ready(): Promise<HealthResponse> {
    const response = await this.health.ready();
    if (response.state !== "ok") {
      throw new ServiceUnavailableException(response);
    }
    return response;
  }
}
