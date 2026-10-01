import { commands } from "@/compat9";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/utils/react-query";

export const mutateFile = (id: string) => {
  const { directus } = useAuth();
  return useMutation({
    mutationFn: (data: Record<string, any>) =>
      directus!.request(commands.readFile(id)),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["files"],
      });
    },
  });
};