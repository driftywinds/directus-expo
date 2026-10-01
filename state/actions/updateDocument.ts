import { commands } from "@/compat9";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation } from "@tanstack/react-query";
import { useCollection } from "../queries/directus/collection";
import { coreCollections } from "../queries/directus/core";
import { queryClient } from "@/utils/react-query";

export const mutateDocument = (
  collection: string,
  id: number | string | "+"
) => {
  const { directus, user } = useAuth();
  const { data: collectionData } = useCollection(collection);
  const coreCollection = coreCollections[collection] as
    | { updateItem?: (id: string) => any; updateMe?: () => any; createItem?: () => any }
    | undefined;

  if ((id === "+" || !id) && !collectionData?.meta?.singleton) {
    return coreCollection?.createItem
      ? coreCollection.createItem()
      : useMutation({
          mutationFn: (data: Record<string, unknown>) => {
            return directus!.request(commands.createItem(collection, data));
          },
        });
  }

  if (collectionData?.meta?.singleton) {
    return useMutation({
      mutationFn: (data: Record<string, unknown>) =>
        directus!.request(commands.updateSingleton(collection, data)),
    });
  }

  if (coreCollection?.updateMe && user?.id === id) {
    return coreCollection.updateMe();
  }
  return coreCollection?.updateItem
    ? coreCollection.updateItem(id as string)
    : useMutation({
        mutationFn: (data: Record<string, unknown>) =>
          directus!.request(
            commands.updateItem(collection, id, data)
          ),
      });
};

// Keep router alive