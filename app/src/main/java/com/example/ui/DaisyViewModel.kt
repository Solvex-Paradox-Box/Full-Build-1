package com.example.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.room.Room
import com.example.data.*
import com.example.engine.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.io.File

class DaisyViewModel(application: Application) : AndroidViewModel(application) {

    private val database: DaisyDatabase by lazy {
        val isTesting = try {
            Class.forName("org.robolectric.RobolectricTestRunner") != null
        } catch (e: Exception) {
            false
        }
        if (isTesting) {
            Room.inMemoryDatabaseBuilder(
                application,
                DaisyDatabase::class.java
            ).allowMainThreadQueries()
                .setQueryExecutor { it.run() }
                .setTransactionExecutor { it.run() }
                .build()
        } else {
            Room.databaseBuilder(
                application,
                DaisyDatabase::class.java,
                "daisy_core_db"
            ).fallbackToDestructiveMigration().build()
        }
    }

    val repository: DaisyRepository by lazy {
        DaisyRepository(database.daisyDao())
    }

    // Engine Instances
    val voiceCoPilot: VoiceCoPilot by lazy {
        VoiceCoPilot(application, repository, viewModelScope)
    }

    val ingressParser: IngressParser by lazy {
        IngressParser(repository)
    }

    val tetherManager: TetherManager by lazy {
        TetherManager(repository, voiceCoPilot)
    }

    val discoveryEngine: DiscoveryEngine by lazy {
        DiscoveryEngine(repository, voiceCoPilot)
    }

    val consensusEngine: ConsensusEngine by lazy {
        ConsensusEngine(repository, voiceCoPilot)
    }

    // UI Input state binding parameters
    val nodeNameInput = MutableStateFlow("Google AI Studio Node Alpha")
    val targetElementInput = MutableStateFlow("textarea.prompt-textarea")
    val targetBucketInput = MutableStateFlow("SOURCE")

    val userWrittenPrompt = MutableStateFlow("DAISY, build a decentralized ledger with local caching and Room database.")

    // Active nodes and state collections
    val ingressFiles: StateFlow<List<IngressFile>> = repository.ingressFiles
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    val tetherNodes: StateFlow<List<TetherNode>> = repository.tetherNodes
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    val discoveryLinks: StateFlow<List<DiscoveryLink>> = repository.discoveryLinks
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    val consensusTasks: StateFlow<List<ConsensusTask>> = repository.consensusTasks
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    val logEvents: StateFlow<List<LogEvent>> = repository.logEvents
        .stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())

    val isSpeaking: StateFlow<Boolean> by lazy { voiceCoPilot.isSpeaking }
    val currentUtterance: StateFlow<String> by lazy { voiceCoPilot.currentUtterance }
    val waveAmplitudes: StateFlow<FloatArray> by lazy { voiceCoPilot.waveAmplitudes }

    init {
        // Pre-populate system with initial sandbox tethers for robust and high-fidelity showcase
        viewModelScope.launch {
            repository.clearAllTetherNodes()
            repository.clearAllConsensusTasks()
            repository.clearAllLogs()

            // Bind initial default tethers for the user
            tetherManager.bindToElement("Google AI Studio (Active)", "div.prompt-container", "SOURCE")
            tetherManager.bindToElement("Meta AI (Backup)", "textarea[name='chat-prompt']", "MAIN")
            
            // Log core startup
            repository.log("DAISY standalone background intelligence layer successfully started. Port 9912.", "INFO")
        }
    }

    /**
     * Binds a new custom element node using input values.
     */
    fun performBindElement() {
        viewModelScope.launch {
            val name = nodeNameInput.value
            val element = targetElementInput.value
            val bucket = targetBucketInput.value
            if (name.isNotEmpty() && element.isNotEmpty()) {
                tetherManager.bindToElement(name, element, bucket)
            }
        }
    }

    /**
     * Deletes/Severs a node tether connection.
     */
    fun severTether(sessionId: String) {
        viewModelScope.launch {
            val node = repository.getTetherNodeById(sessionId)
            if (node != null) {
                repository.deleteTetherNode(sessionId)
                repository.log("Severed MMTAI anchor connection for node ${node.name}", "WARNING")
                voiceCoPilot.speak("Severed anchor connection for node ${node.name}.")
            }
        }
    }

    /**
     * Ingests a new file from manual prompt.
     */
    fun ingestManualFile(fileName: String, content: String) {
        viewModelScope.launch {
            if (fileName.isNotEmpty() && content.isNotEmpty()) {
                ingressParser.ingestFile(fileName, "sandbox/$fileName", content)
            }
        }
    }

    /**
     * Trigger simulated or real file drag & drop.
     */
    fun simulateDragDropFile(name: String, content: String) {
        viewModelScope.launch {
            ingressParser.ingestFile(name, "ingress/$name", content)
            voiceCoPilot.speak("I've cataloged your uploaded file $name. Reference Graph updated.")
        }
    }

    /**
     * Simulates downloading/unpacking a multi-directory zip archive.
     */
    fun simulateZipDrop() {
        viewModelScope.launch {
            repository.log("Processing ZIP archive drop structure...", "INFO")
            val sampleFiles = listOf(
                Pair("MainActivity.kt", "package com.example\n\nimport android.os.Bundle\n\nclass MainActivity: Activity() {\n  // MAIN Core initialization entry point\n}"),
                Pair("LocalCacheManager.kt", "package com.example.db\n\nclass LocalCacheManager {\n  fun saveLocally(data: String) {\n    // SOURCE Core caching logic\n  }\n}"),
                Pair("AndroidManifest.xml", "<manifest>\n  <!-- METADATA Package contracts -->\n</manifest>")
            )
            for (file in sampleFiles) {
                ingressParser.ingestFile(file.first, "src/main/java/${file.first}", file.second)
            }
            voiceCoPilot.speak("Successfully cataloged and indexed your source zip file under SOURCE and MAIN buckets.")
        }
    }

    /**
     * Imports and extracts a real ZIP file selected by the user.
     */
    fun importZipFile(uri: android.net.Uri) {
        viewModelScope.launch {
            repository.log("Opening selected ZIP archive...", "INFO")
            try {
                val context = getApplication<Application>()
                val inputStream = context.contentResolver.openInputStream(uri)
                if (inputStream == null) {
                    repository.log("Failed to open stream for selected ZIP.", "ERROR")
                    voiceCoPilot.speak("Failed to open the selected ZIP file.")
                    return@launch
                }

                val zipInputStream = java.util.zip.ZipInputStream(inputStream)
                var entry = zipInputStream.getNextEntry()
                var count = 0

                while (entry != null) {
                    if (!entry.isDirectory) {
                        val name = entry.name
                        // Only ingest source or readable files
                        val isReadable = name.endsWith(".kt") || name.endsWith(".java") ||
                                name.endsWith(".json") || name.endsWith(".xml") ||
                                name.endsWith(".txt") || name.endsWith(".md") ||
                                name.endsWith(".properties") || name.endsWith(".gradle")

                        if (isReadable) {
                            val byteOut = java.io.ByteArrayOutputStream()
                            val buffer = ByteArray(4096)
                            var bytesRead = zipInputStream.read(buffer)
                            while (bytesRead != -1) {
                                byteOut.write(buffer, 0, bytesRead)
                                bytesRead = zipInputStream.read(buffer)
                            }
                            val content = byteOut.toString("UTF-8")
                            val shortName = name.substringAfterLast('/')

                            ingressParser.ingestFile(shortName, name, content)
                            count++
                        }
                    }
                    zipInputStream.closeEntry()
                    entry = zipInputStream.getNextEntry()
                }
                zipInputStream.close()

                if (count > 0) {
                    repository.log("Successfully ingested $count code files from ZIP archive.", "SUCCESS")
                    voiceCoPilot.speak("Successfully parsed and ingested $count files from the ZIP archive.")
                } else {
                    repository.log("No compatible source code files (.kt, .json, .xml, etc.) found in the ZIP.", "WARNING")
                    voiceCoPilot.speak("I couldn't find any compatible code files in that ZIP archive.")
                }
            } catch (e: Exception) {
                repository.log("Error during ZIP ingestion: ${e.localizedMessage}", "ERROR")
                voiceCoPilot.speak("An error occurred while parsing the ZIP file.")
            }
        }
    }

    /**
     * Analyze requirements based on current user prompt.
     */
    fun analyzeCodebaseGaps() {
        viewModelScope.launch {
            val prompt = userWrittenPrompt.value
            val current = ingressFiles.value
            discoveryEngine.analyzeRequirements(prompt, current)
        }
    }

    /**
     * Triggers the Map-Reduce task allocation among connected tethers.
     */
    fun triggerMapReduce() {
        viewModelScope.launch {
            val prompt = userWrittenPrompt.value
            val activeNodes = tetherNodes.value.filter { it.status == "CONNECTED" }
            consensusEngine.distributeTask(prompt, activeNodes)
        }
    }

    /**
     * Force-trips the circuit breaker on a specific node to demonstrate self-healing routing.
     */
    fun forceTripNode(sessionId: String) {
        viewModelScope.launch {
            tetherManager.triggerCircuitBreaker(sessionId, "User manual injection override limit.")
        }
    }

    /**
     * Reconnects/resets a tripped node.
     */
    fun reconnectNode(sessionId: String) {
        viewModelScope.launch {
            val node = repository.getTetherNodeById(sessionId)
            if (node != null) {
                val reconnectedNode = node.copy(status = "CONNECTED", errorCount = 0)
                repository.insertTetherNode(reconnectedNode)
                repository.log("Reconnected MMTAI anchor session for ${node.name}", "INFO")
                voiceCoPilot.speak("Reconnected and synchronized ${node.name}.")
            }
        }
    }

    /**
     * Validates code typing consensus and automatically triggers Conflict Arbitration.
     */
    fun runConsensusValidation() {
        viewModelScope.launch {
            // First simulate code responses from active nodes
            val nodes = tetherNodes.value
            for (node in nodes) {
                if (node.status == "CONNECTED" || node.status == "SYNCING") {
                    val codeSim = if (node.targetBucket == "SOURCE") {
                        "// Generated schemas\ndata class UserEntity(@PrimaryKey val id: Int)\nclass LocalRepo(val id: Int)"
                    } else {
                        "// UI Components\nfun UserProfile(user: UserEntity) {\n  val userId: String = user.userId\n}"
                    }
                    tetherManager.receiveResponseToken(node.sessionId, codeSim)
                }
            }

            // Now run validation and conflict arbitration
            consensusEngine.validateConsensusAndArbitrate()
        }
    }

    /**
     * Speaks a custom phrase.
     */
    fun speakCustom(text: String) {
        voiceCoPilot.speak(text)
    }

    /**
     * Clears all log events from telemetry.
     */
    fun clearLogs() {
        viewModelScope.launch {
            repository.clearAllLogs()
        }
    }

    override fun onCleared() {
        super.onCleared()
        voiceCoPilot.shutdown()
    }
}
