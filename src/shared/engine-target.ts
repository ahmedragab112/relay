export type EngineArch = 'x64' | 'arm64';
export type EngineFormat = 'mach-o' | 'pe' | 'elf';

export interface EngineTarget {
  platform: NodeJS.Platform;
  arch: EngineArch;
  packageName: string;
  binary: string;
  format: EngineFormat;
}

const packageOS: Partial<Record<NodeJS.Platform, string>> = { darwin: 'darwin', win32: 'windows', linux: 'linux' };

function supported(platform: NodeJS.Platform, arch: string): asserts arch is EngineArch {
  if (!packageOS[platform] || (arch !== 'x64' && arch !== 'arm64')) {
    throw new Error(`OpenCode does not ship a binary for ${platform}-${arch}.`);
  }
}

export function enginePackageName(platform: NodeJS.Platform, arch: string): string {
  supported(platform, arch);
  return `@opencode/cli-${packageOS[platform]}-${arch}`;
}

export function engineBinaryName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'opencode.exe' : 'opencode';
}

export function binaryFormat(head: Uint8Array): EngineFormat | 'unknown' {
  if (head.length >= 4) {
    const [a, b, c, d] = head;
    if ((a === 0xcf || a === 0xce) && b === 0xfa && c === 0xed && d === 0xfe) return 'mach-o';
    if (a === 0xca && b === 0xfe && c === 0xba && d === 0xbe) return 'mach-o';
    if (a === 0x7f && b === 0x45 && c === 0x4c && d === 0x46) return 'elf';
  }
  if (head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a) return 'pe';
  return 'unknown';
}

export function engineTarget(platform: NodeJS.Platform, arch: string): EngineTarget {
  const format: Partial<Record<NodeJS.Platform, EngineFormat>> = { darwin: 'mach-o', win32: 'pe', linux: 'elf' };
  const expected = format[platform];
  if (!expected) throw new Error(`OpenCode does not ship a binary for ${platform}-${arch}.`);
  return { platform, arch: arch as EngineArch, packageName: enginePackageName(platform, arch), binary: engineBinaryName(platform), format: expected };
}
