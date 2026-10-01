import { useAuth } from "@/contexts/AuthContext";
import {
  commands,
  type CoreSchema,
} from "@/compat9";
import {
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { coreCollections } from "./core";
import { get, unset } from "lodash";
import { useMemo } from "react";
import { DirectusErrorResponse } from "@/types/directus";
import { getPrimaryKey } from "@/hooks/primaryKeyUtils";

export const useCollection = (id: string) => {
  const { directus, user } = useAuth();
  return useQuery({
    queryKey: ["collection", id, user?.id],
    queryFn: () => directus?.request(commands.readCollection(id)),
  });
};

export const useDocuments = (
  collection: string,
  query?: Record<string, any>,
  options?: Omit<UseQueryOptions<{ items: any[]; total: number }>, "queryKey" | "queryFn">
) => {
  const { directus } = useAuth();
  const coreCollection = coreCollections[collection];
  const { data: fields } = useFields(collection as any);
  
  return coreCollection?.readItems
    ? coreCollection.readItems(query)
    : useQuery({
      queryKey: ["documents", collection, query, options],

      queryFn: async () => {
        const items = await directus?.request(
          commands.readItems(collection, query)
        );
        const aggregateQuery = { ...query };
        unset(aggregateQuery, ["page"]);
        const pk = getPrimaryKey(fields);
        const pagination = !!pk ? await directus?.request(
          commands.aggregate(collection, {
            aggregate: { countDistinct: `${pk}` },
            query: aggregateQuery,
          })
        ) : undefined;

        const total = !!pk ? Number(get(pagination, `0.countDistinct.${pk}`)) : 0;

        return {
          items: items || [],
          total: !isNaN(total) ? total : 0,
        };
      },
      ...options,
    });
};

export const useDocument = ({
  collection,
  id,
  options,
  query
}: {
  collection: string;
  id?: number | string | "+";
  options?: Record<string, any>;
  query?: Omit<UseQueryOptions<any, Error | DirectusErrorResponse>, "queryKey" | "queryFn">;
}) => {
  const { directus } = useAuth();
  const { data: collectionData } = useCollection(collection);

  const coreCollection = coreCollections[collection];

  if (id === "+") {
    return useQuery({
      queryKey: ["document-add", collection, "+"],
      queryFn: async () => ({}),
      ...query,
    });
  }

  if (collectionData?.meta?.singleton) {
    return useQuery({
      queryKey: ["document", collection, id, options, query],
      queryFn: async () =>
        directus?.request(commands.readSingleton(collection, options)),
      retry: false,
      ...query,
    });
  } else
    return coreCollection?.readItem
      ? coreCollection.readItem(id as string)
      : useQuery({
        queryKey: ["document", collection, id],
        queryFn: async () =>
          directus?.request(commands.readItem(collection, id!, options)),
        ...query,
      });
};

export const useFields = (collection: string) => {
  const { directus, user } = useAuth();
  return useQuery({
    queryKey: ["fields", collection, user?.id],
    queryFn: () => directus?.request(commands.readFieldsByCollection(collection)),
  });
};

export const useField = (collection: string, field: string) => {
  const { directus, user } = useAuth();
  return useQuery({
    queryKey: ["field", collection, field, user?.id],
    queryFn: () => directus?.request(commands.readField(collection, field)),
  });
};

export const useAllFields = () => {
  const { directus, user } = useAuth();
  return useQuery({
    queryKey: ["fields-all", user?.id],
    queryFn: () => directus?.request(commands.readFields()),
  });
};

export const usePresets = () => {
  const { directus, user } = useAuth();
  return useQuery({
    queryKey: ["presets", user?.id],
    staleTime: 60 * 1000, // 1 minute
    queryFn: () => directus?.request(commands.readPresets()),
  });
};