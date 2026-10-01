import { commands } from "@/compat9";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation } from "@tanstack/react-query";

export const addPolicy = () => {
  // D9: no separate policies collection. Roles are used instead.
  // This maps to creating a role.
  const { directus } = useAuth();
  return useMutation({
    mutationFn: (data: Record<string, any>) =>
      directus!.request(commands.createRole(data)),
  });
};