import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

const DEFAULT_COLLECTION_HANDLES = ["frontpage", "all-equipment"];

function getGraphQLErrorMessage(payload: any, fallback: string) {
  return (
    payload?.errors?.[0]?.message ||
    payload?.data?.productCreate?.userErrors?.[0]?.message ||
    fallback
  );
}

function collectUserErrorMessages(userErrors: Array<{ message?: string }> = []) {
  return userErrors
    .map((err) => err?.message)
    .filter((msg): msg is string => Boolean(msg));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const color = ["Red", "Orange", "Yellow", "Green"][
    Math.floor(Math.random() * 4)
  ];
  try {
    const warnings: string[] = [];
    const collectionsAdded: string[] = [];
    let publicationName: string | null = null;

    const response = await admin.graphql(
      `#graphql
        mutation populateProduct($product: ProductCreateInput!) {
          productCreate(product: $product) {
            product {
              id
              title
              handle
              status
              variants(first: 10) {
                edges {
                  node {
                    id
                    price
                    barcode
                    createdAt
                  }
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          product: {
            title: `${color} Snowboard`,
            status: "ACTIVE",
          },
        },
      },
    );

    const responseJson = await response.json();
    const productCreate = responseJson?.data?.productCreate;

    if (
      responseJson?.errors?.length ||
      productCreate?.userErrors?.length ||
      !productCreate?.product
    ) {
      const message = getGraphQLErrorMessage(
        responseJson,
        "No se pudo crear el producto",
      );

      return {
        error: message,
        product: null,
        variant: null,
        metaobject: null,
        automation: null,
      };
    }

    const product = productCreate.product;
    const variantId = product?.variants?.edges?.[0]?.node?.id;
    let variant = null;

    if (variantId) {
      const variantResponse = await admin.graphql(
        `#graphql
        mutation shopifyReactRouterTemplateUpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants {
              id
              price
              barcode
              createdAt
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            productId: product.id,
            variants: [{ id: variantId, price: "100.00" }],
          },
        },
      );

      const variantResponseJson = await variantResponse.json();
      const variantUpdate = variantResponseJson?.data?.productVariantsBulkUpdate;

      if (!variantResponseJson?.errors?.length && !variantUpdate?.userErrors?.length) {
        variant = variantUpdate?.productVariants ?? null;
      } else {
        const variantErrors = [
          ...(variantResponseJson?.errors || []).map((err: any) => err?.message),
          ...collectUserErrorMessages(variantUpdate?.userErrors || []),
        ].filter(Boolean);

        if (variantErrors.length) {
          warnings.push(`Variant update: ${variantErrors.join(" | ")}`);
        }
      }
    }

    try {
      const publicationsResponse = await admin.graphql(
        `#graphql
          query getPublications {
            publications(first: 20) {
              nodes {
                id
                name
              }
            }
          }`,
      );
      const publicationsJson = await publicationsResponse.json();
      const publicationNodes = publicationsJson?.data?.publications?.nodes || [];
      const onlineStorePublication = publicationNodes.find((pub: any) =>
        /(online store|tienda online)/i.test(pub?.name || ""),
      );

      if (onlineStorePublication?.id) {
        publicationName = onlineStorePublication?.name || null;
        const publishResponse = await admin.graphql(
          `#graphql
            mutation publishToOnlineStore($id: ID!, $publicationId: ID!) {
              publishablePublish(
                id: $id
                input: [{ publicationId: $publicationId }]
              ) {
                userErrors {
                  field
                  message
                }
              }
            }`,
          {
            variables: {
              id: product.id,
              publicationId: onlineStorePublication.id,
            },
          },
        );
        const publishJson = await publishResponse.json();
        const publishErrors = [
          ...(publishJson?.errors || []).map((err: any) => err?.message),
          ...collectUserErrorMessages(
            publishJson?.data?.publishablePublish?.userErrors || [],
          ),
        ].filter(Boolean);

        if (publishErrors.length) {
          warnings.push(`Publication: ${publishErrors.join(" | ")}`);
        }
      } else {
        warnings.push(
          "No se encontro la publicacion de Tienda online para publicacion automatica.",
        );
      }
    } catch (error) {
      warnings.push("No se pudo ejecutar la publicacion automatica.");
      console.error("Auto publication failed", error);
    }

    for (const handle of DEFAULT_COLLECTION_HANDLES) {
      try {
        const collectionResponse = await admin.graphql(
          `#graphql
            query getCollectionByHandle($query: String!) {
              collections(first: 1, query: $query) {
                nodes {
                  id
                  handle
                }
              }
            }`,
          { variables: { query: `handle:${handle}` } },
        );
        const collectionJson = await collectionResponse.json();
        const collection = collectionJson?.data?.collections?.nodes?.[0];

        if (!collection?.id) {
          warnings.push(`No se encontro la coleccion: ${handle}`);
          continue;
        }

        const addToCollectionResponse = await admin.graphql(
          `#graphql
            mutation addProductToCollection($id: ID!, $productIds: [ID!]!) {
              collectionAddProducts(id: $id, productIds: $productIds) {
                userErrors {
                  field
                  message
                }
              }
            }`,
          {
            variables: {
              id: collection.id,
              productIds: [product.id],
            },
          },
        );
        const addJson = await addToCollectionResponse.json();
        const addErrors = [
          ...(addJson?.errors || []).map((err: any) => err?.message),
          ...collectUserErrorMessages(
            addJson?.data?.collectionAddProducts?.userErrors || [],
          ),
        ].filter(Boolean);

        if (addErrors.length) {
          const nonDuplicateErrors = addErrors.filter(
            (msg) => !/already exists|ya existe/i.test(msg),
          );
          if (nonDuplicateErrors.length) {
            warnings.push(`Collection ${handle}: ${nonDuplicateErrors.join(" | ")}`);
          }
        } else {
          collectionsAdded.push(handle);
        }
      } catch (error) {
        warnings.push(`No se pudo agregar a coleccion ${handle}.`);
        console.error(`Collection assignment failed for ${handle}`, error);
      }
    }

    return {
      error: null,
      product,
      variant,
      metaobject: null,
      automation: {
        publicationName,
        collectionsAdded,
        warnings,
      },
    };
  } catch (error) {
    console.error("Generate product failed", error);
    return {
      error: "Unexpected Server Error while generating product",
      product: null,
      variant: null,
      metaobject: null,
      automation: null,
    };
  }
};

export default function Index() {
  const fetcher = useFetcher<typeof action>();

  const shopify = useAppBridge();
  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  useEffect(() => {
    if (fetcher.data?.product?.id) {
      if (fetcher.data?.automation?.warnings?.length) {
        shopify.toast.show("Producto creado con avisos. Revisa el resultado JSON.");
      } else {
        shopify.toast.show("Producto creado y publicado automaticamente");
      }
    }
    if (fetcher.data?.error) {
      shopify.toast.show(fetcher.data.error);
    }
  }, [fetcher.data?.product?.id, fetcher.data?.error, fetcher.data?.automation?.warnings?.length, shopify]);

  const generateProduct = () => fetcher.submit({}, { method: "POST" });

  return (
    <s-page heading="Shopify app template">
      <s-button slot="primary-action" onClick={generateProduct}>
        Generate a product
      </s-button>

      <s-section heading="Congrats on creating a new Shopify app 🎉">
        <s-paragraph>
          This embedded app template uses{" "}
          <s-link
            href="https://shopify.dev/docs/apps/tools/app-bridge"
            target="_blank"
          >
            App Bridge
          </s-link>{" "}
          interface examples like an{" "}
          <s-link href="/app/additional">additional page in the app nav</s-link>
          , as well as an{" "}
          <s-link
            href="https://shopify.dev/docs/api/admin-graphql"
            target="_blank"
          >
            Admin GraphQL
          </s-link>{" "}
          mutation demo, to provide a starting point for app development.
        </s-paragraph>
      </s-section>
      <s-section heading="Get started with products">
        <s-paragraph>
          Generate a product with GraphQL and get the JSON output for that
          product. Learn more about the{" "}
          <s-link
            href="https://shopify.dev/docs/api/admin-graphql/latest/mutations/productCreate"
            target="_blank"
          >
            productCreate
          </s-link>{" "}
          mutation in our API references. Includes a product{" "}
          <s-link
            href="https://shopify.dev/docs/apps/build/custom-data/metafields"
            target="_blank"
          >
            metafield
          </s-link>{" "}
          and{" "}
          <s-link
            href="https://shopify.dev/docs/apps/build/custom-data/metaobjects"
            target="_blank"
          >
            metaobject
          </s-link>
          .
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button
            onClick={generateProduct}
            {...(isLoading ? { loading: true } : {})}
          >
            Generate a product
          </s-button>
          {fetcher.data?.product && (
            <s-button
              onClick={() => {
                shopify.intents.invoke?.("edit:shopify/Product", {
                  value: fetcher.data?.product?.id,
                });
              }}
              target="_blank"
              variant="tertiary"
            >
              Edit product
            </s-button>
          )}
        </s-stack>
        {fetcher.data?.product && (
          <s-section heading="productCreate mutation">
            <s-stack direction="block" gap="base">
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  <code>{JSON.stringify(fetcher.data.product, null, 2)}</code>
                </pre>
              </s-box>

              <s-heading>productVariantsBulkUpdate mutation</s-heading>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  <code>{JSON.stringify(fetcher.data.variant, null, 2)}</code>
                </pre>
              </s-box>

              <s-heading>metaobjectUpsert mutation</s-heading>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  <code>
                    {JSON.stringify(fetcher.data.metaobject, null, 2)}
                  </code>
                </pre>
              </s-box>

              <s-heading>automation result</s-heading>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  <code>{JSON.stringify(fetcher.data.automation, null, 2)}</code>
                </pre>
              </s-box>
            </s-stack>
          </s-section>
        )}
      </s-section>

      <s-section slot="aside" heading="App template specs">
        <s-paragraph>
          <s-text>Framework: </s-text>
          <s-link href="https://reactrouter.com/" target="_blank">
            React Router
          </s-link>
        </s-paragraph>
        <s-paragraph>
          <s-text>Interface: </s-text>
          <s-link
            href="https://shopify.dev/docs/api/app-home/using-polaris-components"
            target="_blank"
          >
            Polaris web components
          </s-link>
        </s-paragraph>
        <s-paragraph>
          <s-text>API: </s-text>
          <s-link
            href="https://shopify.dev/docs/api/admin-graphql"
            target="_blank"
          >
            GraphQL
          </s-link>
        </s-paragraph>
        <s-paragraph>
          <s-text>Custom data: </s-text>
          <s-link
            href="https://shopify.dev/docs/apps/build/custom-data"
            target="_blank"
          >
            Metafields &amp; metaobjects
          </s-link>
        </s-paragraph>
        <s-paragraph>
          <s-text>Database: </s-text>
          <s-link href="https://www.prisma.io/" target="_blank">
            Prisma
          </s-link>
        </s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Next steps">
        <s-unordered-list>
          <s-list-item>
            Build an{" "}
            <s-link
              href="https://shopify.dev/docs/apps/getting-started/build-app-example"
              target="_blank"
            >
              example app
            </s-link>
          </s-list-item>
          <s-list-item>
            Explore Shopify&apos;s API with{" "}
            <s-link
              href="https://shopify.dev/docs/apps/tools/graphiql-admin-api"
              target="_blank"
            >
              GraphiQL
            </s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
