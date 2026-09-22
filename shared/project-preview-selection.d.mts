export interface PreviewSelectionRuntimeConfig {
  workbenchOrigin: string;
  projectId: string;
  runtimeId: string;
  revision: string;
}
export function installPreviewSelectionBridge(
  config: PreviewSelectionRuntimeConfig
): () => void;
