import { commands } from "@/compat9";
import { useAuth } from "@/contexts/AuthContext";
import { queryClient } from "@/utils/react-query";
import { useMutation } from "@tanstack/react-query";

export const removeFile = (id: string) => {
  const { directus } = useAuth();
  return useMutation({
    mutationFn: () => directus!.request(commands.deleteFile(id)),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["files"],
      });
    },
  });
};