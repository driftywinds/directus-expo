import { commands } from "@/compat9";

import { useAuth } from "@/contexts/AuthContext";
import { useMutation } from "@tanstack/react-query";
import { coreCollections } from "../queries/directus/core";
import { useCollection } from "../queries/directus/collection";

export const mutateDocuments = (
  collection: string,
  id: number | string | "+"
) => {
  const { directus, user } = useAuth();
  const { data } = useCollection(collection);
  const { createItems: createCoreItems } = coreCollections[collection] || {};

  return createCoreItems
    ? createCoreItems()
    : useMutation({
        mutationFn: (data: Record<string, any>) => {
          console.log("createItem", collection, id);
          return directus!.request(commands.createItem(collection, data));
        },
      });

  /**
  return updateCoreItems
    ? updateCoreItems(id as string)
    : useMutation({
        mutationFn: (data: Record<string, unknown>) =>
          directus!.request(
            updateItems(collection as keyof CoreSchema, id, data)
          ),
      }); */
};