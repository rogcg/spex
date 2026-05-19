import type { TechSpec } from '@spex/schemas';
import { stringify as stringifyYaml } from 'yaml';

export function techSpecToYaml(spec: TechSpec): string {
  return stringifyYaml(spec, {
    indent: 2,
    lineWidth: 0,
  });
}
