import { useState, useRef, useCallback, useEffect } from "react";
import { Camera, X, SwitchCamera, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/queryClient";
import { uploadFile } from "@/lib/upload";
import { useToast } from "@/hooks/use-toast";

interface CameraCaptureProps {
  onCapture: (attachment: { url: string; name: string; type: string; preview: string }) => void;
  onClose: () => void;
}

export default function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [capturing, setCapturing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const { toast } = useToast();

  const startCamera = useCallback(async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((d) => d.kind === "videoinput");
      setHasMultipleCameras(videoDevices.length > 1);
    } catch (err) {
      toast({ description: "Camera access denied", variant: "destructive" });
      onClose();
    }
  }, [facingMode, toast, onClose]);

  useEffect(() => {
    startCamera();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [facingMode]);

  const capturePhoto = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setCapturing(true);
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video.videoWidth || !video.videoHeight) {
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => resolve();
        setTimeout(resolve, 1000);
      });
    }

    canvas.width = Math.min(video.videoWidth, 2048);
    canvas.height = Math.min(video.videoHeight, Math.round((video.videoHeight / video.videoWidth) * 2048));

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setPreview(dataUrl);

    streamRef.current?.getTracks().forEach((t) => t.stop());
    setCapturing(false);
  }, []);

  const uploadAndAttach = useCallback(async () => {
    if (!preview || !canvasRef.current) return;

    setUploading(true);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvasRef.current!.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Failed to create blob"))),
          "image/jpeg",
          0.9
        );
      });

      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
      const data = await uploadFile(file);
      onCapture({
        url: data.url,
        name: data.filename,
        type: "image/jpeg",
        preview,
      });
      onClose();
    } catch (err: any) {
      toast({ description: err.message || "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }, [preview, onCapture, onClose, toast]);

  const retake = useCallback(() => {
    setPreview(null);
    startCamera();
  }, [startCamera]);

  const switchCamera = useCallback(() => {
    setFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center" data-testid="camera-capture-overlay">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-4 right-4 z-10"
        onClick={onClose}
        data-testid="button-close-camera"
      >
        <X className="w-5 h-5" />
      </Button>

      <div className="flex flex-col items-center gap-4 max-w-lg w-full px-4">
        <div className="relative w-full aspect-[4/3] bg-black rounded-xl overflow-hidden">
          {preview ? (
            <img src={preview} alt="Captured" className="w-full h-full object-contain" data-testid="camera-preview" />
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={cn("w-full h-full object-cover", facingMode === "user" && "scale-x-[-1]")}
              data-testid="camera-viewfinder"
            />
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />

        <div className="flex items-center gap-4">
          {preview ? (
            <>
              <Button variant="outline" onClick={retake} data-testid="button-retake">
                <Camera className="w-4 h-4 mr-2" /> Retake
              </Button>
              <Button onClick={uploadAndAttach} disabled={uploading} data-testid="button-use-photo">
                {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                Use Photo
              </Button>
            </>
          ) : (
            <>
              {hasMultipleCameras && (
                <Button variant="ghost" size="icon" onClick={switchCamera} data-testid="button-switch-camera">
                  <SwitchCamera className="w-5 h-5" />
                </Button>
              )}
              <Button
                size="lg"
                className="rounded-full w-16 h-16"
                onClick={capturePhoto}
                disabled={capturing}
                data-testid="button-take-photo"
              >
                <Camera className="w-6 h-6" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
