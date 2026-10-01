import { commands } from "@/compat9";

import { useAuth } from "@/contexts/AuthContext";
import { useMutation } from "@tanstack/react-query";
import { coreCollections } from "../queries/directus/core";
import { useCollection } from "../queries/directus/collection";

export const deleteDocuments = (
  collection: string,
  ids: number[] | string[]
) => {
  const { directus, user } = useAuth();
  const { data } = useCollection(collection);
  const { removeItems: removeCoreItems } = coreCollections[collection] || {};

  return removeCoreItems
    ? removeCoreItems(ids as string[])
    : useMutation({
        mutationFn: () =>
          directus!.request(commands.deleteItems(collection, ids)),
      });
};