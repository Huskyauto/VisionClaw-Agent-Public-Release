/** Tenant-bound image production; invoked only with server-stamped tool params. */
export async function generateSocialImageTool(params: Record<string, any>, dependencies: {
  errorMessage: (error: unknown, fallback?: string) => string;
  retryWithBackoff: <T>(work: () => Promise<T>, options: { retries: number; delayMs: number; label: string }) => Promise<T>;
}) {
  const { errorMessage, retryWithBackoff } = dependencies;
  if (!Number.isSafeInteger(params._tenantId) || params._tenantId <= 0) {
    return { error: "A valid authenticated tenant is required to generate an image" };
  }
  const { generateImage } = await import("../replit_integrations/image/client");
  const { uploadAndShare } = await import("../google-drive");
  const fsP = await import("fs/promises");
  const stylePrefix: Record<string, string> = {
    professional: "Clean, professional corporate style with modern design,",
    minimalist: "Minimalist design with ample white space and subtle colors,",
    vibrant: "Bold, vibrant colors with high contrast and energy,",
    tech: "Futuristic tech aesthetic with gradients, circuits, and digital elements,",
    corporate: "Polished corporate style suitable for business presentations,",
    creative: "Artistic, creative style with unique composition,",
    photorealistic: "Photorealistic, high-quality photograph-style,",
    illustration: "Modern digital illustration style,",
    infographic: "Clean infographic-style with data visualization elements,",
  };
  const platformHint: Record<string, string> = {
    x: "Optimized for Twitter/X (16:9 aspect ratio, bold text if any, eye-catching).",
    linkedin: "Professional LinkedIn post image (1200x627, clean and corporate).",
    instagram: "Square format (1:1) optimized for Instagram feed.",
    facebook: "Facebook post image (1200x630, engaging and shareable).",
    blog: "Blog header image (16:9, professional and relevant to topic).",
    general: "General-purpose marketing image.",
  };
  const style = params.style || "professional";
  const platform = params.platform || "general";
  const fullPrompt = `${stylePrefix[style] || ""} ${platformHint[platform] || ""} ${params.prompt}. No text overlays unless specifically requested.`;
  const refPathsRaw = Array.isArray(params.reference_image_paths) ? params.reference_image_paths : [];
  const refPaths: string[] = [];
  const referenceCleanups: Array<() => void> = [];
  try {
    if (refPathsRaw.length > 0) {
      const { filterAllowedRefPaths } = await import("./image-ref-jail");
      // Keep the existing root jail AND verify ownership before reference bytes
      // can reach the model. The client independently re-applies the root jail.
      const stringified = refPathsRaw.map((p: unknown) => String(p || ""));
      const { allowed: jailed, rejected: jailRejected } = filterAllowedRefPaths(stringified);
      if (jailRejected.length > 0) {
        console.warn(`[generate_social_image] R99.1 +sec: rejected ${jailRejected.length} reference path(s) outside allowed roots (project-assets/uploads/attached_assets)`);
      }
      const { resolveInputPath } = await import("../video-editor");
      for (const ref of jailed) {
        const resolved = await resolveInputPath(ref, params._tenantId);
        refPaths.push(resolved.filePath);
        if (resolved.cleanup) referenceCleanups.push(resolved.cleanup);
      }
    }
    // Establish the canonical output namespace before buying a generation.
    const pathMod = await import("path");
    const fsMod = await import("fs");
    const assetsRoot = pathMod.resolve(process.cwd(), "project-assets");
    const tenantDirectory = `tenant-${params._tenantId}`;
    const assetsDir = pathMod.join(assetsRoot, tenantDirectory);
    if (!fsMod.existsSync(assetsDir)) fsMod.mkdirSync(assetsDir, { recursive: true });
    if (fsMod.realpathSync(assetsDir) !== pathMod.join(fsMod.realpathSync(assetsRoot), tenantDirectory)) {
      throw new Error("Generated-image output namespace is redirected outside the authenticated tenant");
    }
    const makeImage = () => generateImage(fullPrompt, {
      tenantId: params._tenantId,
      model: params.image_model,
      purpose: params.purpose,
      callerLabel: "generate_social_image",
      ...(refPaths.length > 0 ? { referenceImagePaths: refPaths } : {}),
    });
    // An ambiguous paid request is never retried by this outer helper.
    const dataUrl = params.image_model?.startsWith("cheaperinference/")
      ? await makeImage()
      : await retryWithBackoff(makeImage, { retries: 3, delayMs: 8000, label: "generate_social_image" });
    const base64Data = dataUrl.split(",")[1];
    const mimeMatch = dataUrl.match(/data:([^;]+);/);
    const mimeType = mimeMatch?.[1] || "image/png";
    const ext = mimeType.includes("jpeg") ? ".jpg" : ".png";
    const fileName = `social-image-${(await import("crypto")).randomUUID()}${ext}`;
    const localPath = pathMod.join(assetsDir, fileName);
    await fsP.writeFile(localPath, Buffer.from(base64Data, "base64"), { flag: "wx", mode: 0o600 });
    const folderLabel = params.folder_label || `${(await import("../site-config")).siteConfig.platformName} Social Media/Generated Images`;
    const driveResult = await uploadAndShare({
      filePath: localPath, fileName, mimeType, folderLabel,
      parentFolderId: params._projectDriveFolderId || undefined,
      tenantId: params._tenantId,
      projectId: params.project_id,
      generatedArtifact: { artifactKind: "image", logicalName: fileName, sourceRunKey: `social-image:${fileName}` },
    });
    if (!driveResult.success) return { error: driveResult.error || "Drive durability verification failed" };
    const driveSuccess = driveResult?.success && driveResult?.viewUrl;
    const fileId = driveResult?.fileId;
    return {
      success: true,
      imageUrl: driveSuccess ? driveResult.viewUrl : undefined,
      downloadUrl: driveSuccess ? (driveResult.downloadUrl || driveResult.viewUrl) : undefined,
      slidesEmbedUrl: fileId ? `https://drive.google.com/uc?export=download&id=${fileId}` : undefined,
      drive_url: driveSuccess ? driveResult.viewUrl : "Drive upload failed — file saved locally",
      local_path: localPath,
      fileName, platform, style,
      prompt: params.prompt,
      instructions: "Image generated. The local_path can be used as a slide image_path in create_slideshow_video.",
    };
  } catch (err) {
    return { error: `Image generation failed: ${errorMessage(err)}` };
  } finally {
    for (const cleanup of referenceCleanups) {
      try { cleanup(); }
      catch { console.warn("[generate_social_image] temporary reference cleanup failed"); }
    }
  }
}
