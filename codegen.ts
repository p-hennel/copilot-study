import { CodegenConfig } from "@graphql-codegen/cli"
import { Types as GQLTypes } from "@graphql-codegen/plugin-helpers"

const config: CodegenConfig = {
  schema: [
    {
      "https://gitlab.com/api/graphql": {
        headers: {
          Authorization: `Bearer ${process.env.CODEGEN_API_KEY}`
        }
      } as GQLTypes.UrlSchemaOptions
    }
  ],
  documents: ["src/crawler/**/*.tsx", "!src/crawler/gql/**/*.tsx"],
  ignoreNoDocuments: true, // Don't error if no operations are found
  generates: {
    // Generate base types (scalars, enums, interfaces, objects)
    "./src/crawler/gql/graphql.ts": {
      plugins: ["typescript"],
      config: {
        useTypeImports: true, // Ensure compatibility with verbatimModuleSyntax
        enumsAsTypes: true // Potentially helps with duplicate enum value issues
        // Add other relevant typescript plugin configs if needed
      }
    },
    // Generate types for GraphQL operations (queries, mutations)
    "./src/crawler/gql/": {
      preset: "near-operation-file",
      presetConfig: {
        extension: ".generated.ts",
        baseTypesPath: "graphql.ts" // Point to the base types file
      },
      plugins: ["typescript-operations"],
      config: {
        useTypeImports: true // Ensure compatibility with verbatimModuleSyntax
        // Add other relevant typescript-operations plugin configs if needed
      }
    }
    // Optional: Generate hooks/components if needed (e.g., for React/Vue/Svelte)
    // "./src/lib/components/gql/hooks.ts": {
    //   plugins: ["typescript-react-apollo"], // Example for React Apollo
    //   config: {
    //     useTypeImports: true,
    //     withHooks: true
    //   }
    // }
  }
}
export default config
