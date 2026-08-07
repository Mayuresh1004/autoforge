import type { FileSystemAnalysis } from '../../domain/models/file-system';
import type { TechnologyDetection } from '../../domain/models/technology';
import type { TechnologyDetector } from '../../domain/ports/technology-detector';
import { DetectionContext } from './detection-context';
import { detectTechnologies } from './detection-engine';
import { TECHNOLOGY_SIGNALS } from './signatures';
import type { TechnologySignal } from './signal';

/**
 * Default signature-based technology detector.
 *
 * The signature catalogue is injectable so tests and future extensions can
 * supply custom or reduced signals without touching the engine.
 */
export class SignatureTechnologyDetector implements TechnologyDetector {
  constructor(private readonly signals: readonly TechnologySignal[] = TECHNOLOGY_SIGNALS) {}

  async detect(analysis: FileSystemAnalysis, rootPath: string): Promise<TechnologyDetection> {
    const context = DetectionContext.create(analysis, rootPath);
    const technologies = await detectTechnologies(this.signals, context);
    return { technologies };
  }
}