export type Identity = { objectId: string; role: "admin" | "special_admin" };
export type Authenticate = (authorization: string | undefined) => Promise<Identity | null>;
