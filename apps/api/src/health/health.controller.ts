import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import type { HealthResponse } from "@pubg-camp/contracts";
import type { HealthService } from "./health.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

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
