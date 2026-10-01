import { commands } from "@/compat9";

import { useAuth } from "@/contexts/AuthContext";
import { useMutation } from "@tanstack/react-query";
import { coreCollections } from "../queries/directus/core";
import { useCollection } from "../queries/directus/collection";
import { queryClient } from "@/utils/react-query";

export const deleteDocument = (
  collection: string,
  id: number | string | "+"
) => {
  const { directus, user } = useAuth();
  const { data } = useCollection(collection);
  const { removeItem: removeCoreItem } = coreCollections[collection] || {};

  return removeCoreItem
    ? removeCoreItem(id as string)
    : useMutation({
        mutationFn: () =>
          directus!.request(commands.deleteItem(collection, id)),
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: ["documents", collection],
          });
        },
      });
};