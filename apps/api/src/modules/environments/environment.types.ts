export type EnvironmentStatus = "creating" | "running" | "stopped" | "error";

export interface EnvironmentRecord {
  key: string;
  port: number;
  status: EnvironmentStatus;
  seed: string;
  tenants: string[];
  createdAt: Date;
  updatedAt: Date;
  runtimePath: string;
}
