package com.example.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "ingress_files")
data class IngressFile(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val path: String,
    val bucket: String, // "MAIN", "SOURCE", "METADATA"
    val content: String,
    val size: Long,
    val timestamp: Long = System.currentTimeMillis()
)

@Entity(tableName = "tether_nodes")
data class TetherNode(
    @PrimaryKey val sessionId: String,
    val name: String, // e.g. "Google AI Studio Node Alpha", "Meta AI Node Beta"
    val targetElement: String, // e.g. "div.prompt-textarea", "textarea[name='prompt']"
    val status: String, // "CONNECTED", "SYNCING", "DISCONNECTED", "HOT_SWAPPING", "RATE_LIMITED"
    val targetBucket: String, // "MAIN", "SOURCE", "METADATA"
    val lastToken: String,
    val errorCount: Int = 0,
    val rateLimitedAt: Long = 0L,
    val xPosition: Float = 100f,
    val yPosition: Float = 300f
)

@Entity(tableName = "discovery_links")
data class DiscoveryLink(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val title: String,
    val url: String,
    val description: String,
    val status: String, // "PENDING", "CONNECTED"
    val requiredInfo: String,
    val timestamp: Long = System.currentTimeMillis()
)

@Entity(tableName = "consensus_tasks")
data class ConsensusTask(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val objective: String,
    val status: String, // "SPLIT", "REDUCING", "COMPLETED", "ARBITRATING"
    val parentId: Long = 0L, // 0 for parent task
    val assignedNodeId: String = "", // sessionId of the tether node
    val resultCode: String = "",
    val timestamp: Long = System.currentTimeMillis()
)

@Entity(tableName = "log_events")
data class LogEvent(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val message: String,
    val type: String, // "INFO", "WARNING", "ERROR", "CIRCUIT_BREAKER", "TTS", "ROUTING"
    val timestamp: Long = System.currentTimeMillis()
)

@Dao
interface DaisyDao {
    // Ingress files
    @Query("SELECT * FROM ingress_files ORDER BY timestamp DESC")
    fun getAllIngressFiles(): Flow<List<IngressFile>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertIngressFile(file: IngressFile)

    @Query("DELETE FROM ingress_files")
    suspend fun clearAllIngressFiles()

    // Tether nodes
    @Query("SELECT * FROM tether_nodes")
    fun getAllTetherNodes(): Flow<List<TetherNode>>

    @Query("SELECT * FROM tether_nodes WHERE sessionId = :sessionId")
    suspend fun getTetherNodeById(sessionId: String): TetherNode?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertTetherNode(node: TetherNode)

    @Query("DELETE FROM tether_nodes WHERE sessionId = :sessionId")
    suspend fun deleteTetherNode(sessionId: String)

    @Query("DELETE FROM tether_nodes")
    suspend fun clearAllTetherNodes()

    // Discovery links
    @Query("SELECT * FROM discovery_links ORDER BY timestamp DESC")
    fun getAllDiscoveryLinks(): Flow<List<DiscoveryLink>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDiscoveryLink(link: DiscoveryLink)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDiscoveryLinks(links: List<DiscoveryLink>)

    @Query("DELETE FROM discovery_links")
    suspend fun clearAllDiscoveryLinks()

    @Transaction
    suspend fun replaceDiscoveryLinks(links: List<DiscoveryLink>) {
        clearAllDiscoveryLinks()
        if (links.isNotEmpty()) insertDiscoveryLinks(links)
    }

    // Consensus tasks
    @Query("SELECT * FROM consensus_tasks ORDER BY timestamp DESC")
    fun getAllConsensusTasks(): Flow<List<ConsensusTask>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertConsensusTask(task: ConsensusTask): Long

    @Query("DELETE FROM consensus_tasks")
    suspend fun clearAllConsensusTasks()

    // Log events
    @Query("SELECT * FROM log_events ORDER BY timestamp DESC LIMIT 100")
    fun getAllLogEvents(): Flow<List<LogEvent>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertLogEvent(event: LogEvent)

    @Query("DELETE FROM log_events")
    suspend fun clearAllLogEvents()
}

@Database(
    entities = [
        IngressFile::class,
        TetherNode::class,
        DiscoveryLink::class,
        ConsensusTask::class,
        LogEvent::class
    ],
    version = 1,
    exportSchema = false
)
abstract class DaisyDatabase : RoomDatabase() {
    abstract fun daisyDao(): DaisyDao
}
