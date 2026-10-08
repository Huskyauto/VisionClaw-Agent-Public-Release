/**
 * The deterministic video template always uses one saved script. It must never
 * infer consent to produce that video from general mentions of YouTube/video.
 * All other video requests use the normal agent planning/tool path.
 */
export function isExplicitSavedVideoRequest(message: string): boolean {
  return /^produce_video from project-assets\/the_meta_launch_script\.txt$/i.test(message.trim());
}