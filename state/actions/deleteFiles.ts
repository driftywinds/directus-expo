import { commands } from "@/compat9";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export const removeFiles = () => {
  const { directus } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => directus!.request(commands.deleteFiles(ids)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] });
    },
  });
};