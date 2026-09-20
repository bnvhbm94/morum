/** No secrets, provider setup, fake data, or external fonts at build time. */
const config={
  reactStrictMode:true,
  poweredByHeader:false,
  webpack(config){
    // Service modules keep NodeNext-compatible `.js` specifiers for their
    // standalone test build; resolve those specifiers to TypeScript in Next.
    config.resolve.extensionAlias={...config.resolve.extensionAlias,'.js':['.ts','.tsx','.js']};
    return config;
  },
};
export default config;
