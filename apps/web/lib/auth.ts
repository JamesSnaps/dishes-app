import { headers } from "next/headers";
import type { AutheliaUser } from "@dishes/shared";

const DEV_USER: AutheliaUser = {
  username: "dev-user",
  displayName: "Dev User",
  groups: ["admins"],
};

export async function getAutheliaUser(): Promise<AutheliaUser> {
  const headerList = await headers();

  const userHeader = process.env.AUTHELIA_USER_HEADER ?? "Remote-User";
  const nameHeader = process.env.AUTHELIA_NAME_HEADER ?? "Remote-Name";
  const groupsHeader = process.env.AUTHELIA_GROUPS_HEADER ?? "Remote-Groups";

  const username = headerList.get(userHeader);

  if (!username) {
    if (process.env.NODE_ENV === "development") {
      return DEV_USER;
    }
    throw new Error("Not authenticated");
  }

  return {
    username,
    displayName: headerList.get(nameHeader) ?? username,
    groups: (headerList.get(groupsHeader) ?? "").split(",").filter(Boolean),
  };
}
