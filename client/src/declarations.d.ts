// Declare CSS module so TypeScript doesn't error on `import './index.css'`
declare module '*.css' {
  const content: Record<string, string>
  export default content
}
