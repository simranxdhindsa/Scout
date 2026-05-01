import { Header } from "@/components/Header"
import { Dropzone } from "@/components/Dropzone"

function App() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground">Upload files</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drag and drop files below or click to browse.
          </p>
        </div>
        <Dropzone />
      </main>
    </div>
  )
}

export default App
