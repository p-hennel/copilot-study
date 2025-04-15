import { CodegenConfig } from "@graphql-codegen/cli";
import { Types as GQLTypes } from "@graphql-codegen/plugin-helpers";

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
  ignoreNoDocuments: true,
  generates: {
    "./src/crawler/gql/": {
      preset: "client"
    }
  }
};

export default config;
