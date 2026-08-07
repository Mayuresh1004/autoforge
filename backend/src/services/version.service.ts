import { config } from '../config';
import { VersionData } from '../types/api.types';

export class VersionService {
  getVersion(): VersionData {
    return {
      name: config.APP_NAME,
      version: config.APP_VERSION,
      environment: config.NODE_ENV,
    };
  }

  getInfo(): VersionData & { description: string } {
    return {
      ...this.getVersion(),
      description: 'AMASS Backend API - Autonomous Multi-Agent Security System',
    };
  }
}
