import React, { useState } from "react";
import { Upload as UploadIcon, Loader2 } from "lucide-react";

interface UploadProps {
  onUploadSuccess: (projectId: string) => void;
  ownerId: string;
}

export const Upload: React.FC<UploadProps> = ({ onUploadSuccess, ownerId }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".zip")) {
      setError("Por favor, envie um arquivo .zip");
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", file.name);
      formData.append("ownerId", ownerId);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData
      });

      const data = await response.json();
      if (response.ok) {
        onUploadSuccess(data.projectId);
      } else {
        setError(data.error || "Erro ao enviar arquivo");
      }
      setIsUploading(false);
    } catch (err: any) {
      setError(err.message);
      setIsUploading(false);
    }
  };

  return (
    <div className="p-6 border-2 border-dashed border-zinc-700 rounded-2xl bg-zinc-900/50 hover:bg-zinc-900/80 transition-all group">
      <label className="flex flex-col items-center justify-center cursor-pointer">
        <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
          {isUploading ? (
            <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
          ) : (
            <UploadIcon className="w-6 h-6 text-emerald-400" />
          )}
        </div>
        <span className="text-zinc-300 font-medium">
          {isUploading ? "Enviando..." : "Clique para enviar seu ZIP"}
        </span>
        <span className="text-zinc-500 text-sm mt-1">
          Vite, React ou Node.js projects
        </span>
        <input
          type="file"
          className="hidden"
          accept=".zip"
          onChange={handleFileChange}
          disabled={isUploading}
        />
      </label>
      {error && <div className="mt-4 text-red-400 text-sm text-center">{error}</div>}
    </div>
  );
};
