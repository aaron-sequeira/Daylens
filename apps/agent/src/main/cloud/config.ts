export interface CloudConfig { url: string; anonKey: string }

const DEFAULT_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export function getCloudConfig(): CloudConfig {
  return {
    url: process.env['WORKSIGHT_CLOUD_URL'] ?? 'http://127.0.0.1:54321',
    anonKey: process.env['WORKSIGHT_CLOUD_ANON_KEY'] ?? DEFAULT_ANON
  };
}
