import { commands } from "@/compat9";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation } from "@tanstack/react-query";

export const mutateUsers = () => {
  const { directus } = useAuth();
  return useMutation({
    mutationFn: (body: { ids: string[]; data: Record<string, any> }) =>
      directus!.request(commands.updateUsers(body.ids, body.data)),
  });
};