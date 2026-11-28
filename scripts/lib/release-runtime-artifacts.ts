const GENERATED_WEEKLY_VIDEO_ARTIFACTS = [
  /^data\/youtube\/scripts\/weekly-\d{4}-\d{2}-\d{2}-src-[a-f0-9]{16}\.json$/,
  /^data\/youtube\/scripts\/weekly-\d{4}-\d{2}-\d{2}-src-[a-f0-9]{16}\.result\.json$/,
  /^data\/youtube\/weekly-\d{4}-\d{2}-\d{2}-src-[a-f0-9]{16}-thumbnail\.png$/,
];

/** Exact generated job metadata/media outputs; source fixtures and other assets remain release inputs. */
export function isReleaseRuntimeArtifact(file: string): boolean {
  return GENERATED_WEEKLY_VIDEO_ARTIFACTS.some(pattern => pattern.test(file));
}
