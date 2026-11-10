export type Secrets = {
  get(ref: string): Promise<string | undefined>;
  set(ref: string, value: string): Promise<void>;
};
