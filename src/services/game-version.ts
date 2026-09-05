export function valorantPatchFromGameVersion(gameVersion: string | null): string | null {
  if (!gameVersion) {
    return null;
  }
  const release = gameVersion.match(/(?:^|\b)release-(\d+)\.(\d+)(?:-|\b)/i);
  if (release) {
    return `${release[1]}.${release[2].padStart(2, "0")}`;
  }
  const plain = gameVersion.trim().match(/^(\d+)\.(\d+)$/);
  return plain ? `${plain[1]}.${plain[2].padStart(2, "0")}` : null;
}
