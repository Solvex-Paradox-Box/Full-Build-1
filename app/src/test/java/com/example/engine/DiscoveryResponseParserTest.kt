package com.example.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class DiscoveryResponseParserTest {
    @Test
    fun acceptsBoundedHttpsReferencesAndDeduplicatesByNormalizedUrl() {
        val response = """
            [
              {"title":"API docs","url":"https://developer.android.com/training/data-storage/room","description":"Room docs","requiredInfo":"DAO contracts"},
              {"title":"Duplicate","url":"https://DEVELOPER.ANDROID.COM/training/data-storage/room/","description":"Duplicate docs","requiredInfo":"Duplicate details"}
            ]
        """.trimIndent()

        val results = DiscoveryResponseParser.parse(response)

        assertEquals(1, results.size)
        assertEquals("API docs", results.single().title)
        assertEquals("PENDING", results.single().status)
    }

    @Test
    fun rejectsNonHttpsAndLocalUrls() {
        assertThrows(IllegalArgumentException::class.java) {
            DiscoveryResponseParser.parse(reference("http://example.com/docs"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            DiscoveryResponseParser.parse(reference("https://localhost/private"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            DiscoveryResponseParser.parse(reference("https://127.0.0.1/private"))
        }
    }

    @Test
    fun rejectsMissingFieldsEmptyArraysAndExcessiveResults() {
        assertThrows(IllegalArgumentException::class.java) {
            DiscoveryResponseParser.parse("""[{"title":"Docs","url":"https://example.com"}]""")
        }
        assertThrows(IllegalArgumentException::class.java) {
            DiscoveryResponseParser.parse("""[{"title":4,"url":"https://example.com/docs","description":"Reference","requiredInfo":"API schema"}]""")
        }
        assertThrows(IllegalArgumentException::class.java) {
            DiscoveryResponseParser.parse("[]")
        }
        val tooMany = (0..DiscoveryResponseParser.MAX_DISCOVERY_RESULTS).joinToString(",") {
            reference("https://example.com/docs/$it").removeSurrounding("[", "]")
        }
        assertThrows(IllegalArgumentException::class.java) {
            DiscoveryResponseParser.parse("[$tooMany]")
        }
    }

    private fun reference(url: String): String =
        """[{"title":"Docs","url":"$url","description":"Reference","requiredInfo":"API schema"}]"""
}
