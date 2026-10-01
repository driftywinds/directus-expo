import { commands } from "@/compat9";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation } from "@tanstack/react-query";

export const addUsers = () => {
  const { directus } = useAuth();
  return useMutation({
    mutationFn: (data: Record<string, any>[]) =>
      directus!.request(commands.createUsers(data)),
  });
};