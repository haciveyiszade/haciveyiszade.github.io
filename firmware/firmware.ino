/**
 * Hacıveyiszade Otomatik Kapı Sistemi
 * ESP32-S3 Firmware (C++)
 * 
 * Bu yazılım, Supabase veritabanını sorgulayarak kapıyı açma isteği (status = 'pending')
 * olup olmadığını kontrol eder. Bir istek bulduğunda Pin 11 üzerinden sinyal gönderir
 * ve isteği sırasıyla 'processing' ve 'completed' olarak günceller.
 * 
 * Gerekli Donanım:
 * - ESP32-S3 Geliştirme Kartı
 * - 5V/3.3V Röle Modülü (Girişi Pin 11'e bağlanacak)
 * - Güç Kaynağı ve Kablolar
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <HTTPUpdate.h>

// --- KULLANICI AYARLARI ---
const char* ssid = "MrDeveloper";          // Wi-Fi Ağ Adınız
const char* password = "F*5531501268";  // Wi-Fi Şifreniz

// Supabase Bağlantı Bilgileri (URL sonuna slash '/' koymayın)
const char* supabaseUrl = "https://xfqdjpwczublqdlfhgfm.supabase.co";
const char* supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmcWRqcHdjenVibHFkbGZoZ2ZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNTI5NTcsImV4cCI6MjA5OTkyODk1N30.ZHEVtzKqxlk_fc1xux00eIDIi35WqIPespFcgUiouww";

// İlk OTA kurulumundan önce bu değeri size verilen cihaz anahtarıyla değiştirin.
// Bu anahtarı herkese açık bir Git deposuna göndermeyin.
const char* otaDeviceToken = "YOUR_OTA_DEVICE_TOKEN";
const char* firmwareVersion = "1.0.0";
const char* otaEndpoint = "https://xfqdjpwczublqdlfhgfm.supabase.co/functions/v1/ota";
// --------------------------

// Donanım Pin Tanımlamaları
const int TRIGGER_PIN = 11;             // Kapıyı tetikleyecek röle pini
const int RELAY_ACTIVE_STATE = HIGH;    // Röle tetikleme tipi (Tetiklendiğinde HIGH, boştayken LOW)
const int RELAY_IDLE_STATE = LOW;

// Çalışma Parametreleri
const int POLL_INTERVAL_MS = 1500;      // Veritabanını sorgulama sıklığı (1.5 saniye)
const int TRIGGER_DURATION_MS = 2000;   // Sinyal gönderme süresi (2 saniye)
const unsigned long OTA_INTERVAL_MS = 60000; // OTA kontrolü (1 dakika)

unsigned long lastOtaCheck = 0;

void checkForOtaUpdate();
void reportOtaStatus(const String& status, const String& errorMessage = "");
String readJsonString(const String& json, const String& key);

void setup() {
  Serial.begin(115200);
  
  // Pin Kurulumu
  pinMode(TRIGGER_PIN, OUTPUT);
  digitalWrite(TRIGGER_PIN, RELAY_IDLE_STATE); // Başlangıçta pasif konuma al

  // Wi-Fi Bağlantısı
  connectToWiFi();
}

void loop() {
  // Wi-Fi bağlantısı koptuysa yeniden bağlanmayı dene
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
    return;
  }

  // Supabase'den bekleyen (pending) kapı açma isteği var mı kontrol et
  long pendingRequestId = checkForPendingRequest();

  if (pendingRequestId != -1) {
    Serial.print("Yeni kapı açma isteği algılandı! ID: ");
    Serial.println(pendingRequestId);

    // 1. İstek durumunu 'processing' (İşleniyor) olarak güncelle
    updateRequestStatus(pendingRequestId, "processing");

    // 2. Röleyi tetikle (Pin 11'i HIGH konumuna getir)
    Serial.println("Kapı rölesi tetikleniyor...");
    digitalWrite(TRIGGER_PIN, RELAY_ACTIVE_STATE);
    
    // Sinyal süresi kadar bekle
    delay(TRIGGER_DURATION_MS);
    
    // Röleyi kapat (Pin 11'i LOW konumuna getir)
    digitalWrite(TRIGGER_PIN, RELAY_IDLE_STATE);
    Serial.println("Kapı rölesi kapatıldı.");

    // 3. İstek durumunu 'completed' (Tamamlandı) olarak güncelle
    updateRequestStatus(pendingRequestId, "completed");
  }

  if (millis() - lastOtaCheck >= OTA_INTERVAL_MS) {
    lastOtaCheck = millis();
    checkForOtaUpdate();
  }

  delay(POLL_INTERVAL_MS);
}

// Wi-Fi Bağlantı Fonksiyonu
void connectToWiFi() {
  Serial.print("Wi-Fi baglantisi kuruluyor: ");
  Serial.println(ssid);
  
  WiFi.begin(ssid, password);
  
  int attempt = 0;
  while (WiFi.status() != WL_CONNECTED && attempt < 20) {
    delay(500);
    Serial.print(".");
    attempt++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWi-Fi baglantisi basarili!");
    Serial.print("IP Adresi: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWi-Fi baglantisi basarisiz! Tekrar deneniyor...");
  }
}

// Supabase'den bekleyen isteği sorgulayan fonksiyon
long checkForPendingRequest() {
  WiFiClientSecure client;
  // HTTPS bağlantıları için SSL sertifikasını doğrulamayı atla (Sertifika süre aşımı hatalarını önler)
  client.setInsecure(); 
  
  HTTPClient http;
  
  // URL: status=eq.pending olan en eski isteği getir
  String url = String(supabaseUrl) + "/rest/v1/door_requests?status=eq.pending&order=created_at.asc&limit=1";
  
  http.begin(client, url);
  http.addHeader("apikey", supabaseAnonKey);
  http.addHeader("Authorization", "Bearer " + String(supabaseAnonKey));
  
  int httpResponseCode = http.GET();
  long requestId = -1;
  
  if (httpResponseCode == 200) {
    String payload = http.getString();
    
    // JSON Kütüphanesi kullanmadan basitçe ID değerini ayıklama
    // Beklenen format: [{"id":12,"created_at":"...","status":"pending"}]
    int idIndex = payload.indexOf("\"id\":");
    if (idIndex != -1) {
      int valStart = idIndex + 5;
      // İki nokta üst üste ve boşlukları atla
      while (payload.charAt(valStart) == ' ' || payload.charAt(valStart) == ':') {
        valStart++;
      }
      
      int valEnd = valStart;
      // Rakamları oku
      while (payload.charAt(valEnd) >= '0' && payload.charAt(valEnd) <= '9') {
        valEnd++;
      }
      
      String idStr = payload.substring(valStart, valEnd);
      requestId = idStr.toInt();
    }
  } else {
    if (httpResponseCode > 0) {
      Serial.print("Sorgu hatasi! HTTP Kodu: ");
      Serial.println(httpResponseCode);
    }
  }
  
  http.end();
  return requestId;
}

// İstek durumunu güncelleyen fonksiyon (pending -> processing -> completed)
void updateRequestStatus(long id, String newStatus) {
  WiFiClientSecure client;
  client.setInsecure();
  
  HTTPClient http;
  
  // URL: Belirli ID'deki isteği hedefle
  String url = String(supabaseUrl) + "/rest/v1/door_requests?id=eq." + String(id);
  
  http.begin(client, url);
  http.addHeader("apikey", supabaseAnonKey);
  http.addHeader("Authorization", "Bearer " + String(supabaseAnonKey));
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");
  
  // PATCH Gövdesi (Status alanını güncelle ve işlem zamanını kaydet)
  String jsonBody;
  if (newStatus == "completed") {
    // completed durumuna geçerken processed_at alanını da dolduruyoruz
    // ISO formatında tarih üretmek zor olduğu için veritabanında default default timezone('utc'...)
    // veya basitçe status güncellemesi yapabiliriz. RLS kuralları için bu yeterlidir.
    jsonBody = "{\"status\":\"" + newStatus + "\",\"processed_at\":\"now()\"}";
  } else {
    jsonBody = "{\"status\":\"" + newStatus + "\"}";
  }
  
  int httpResponseCode = http.PATCH(jsonBody);
  
  if (httpResponseCode == 200 || httpResponseCode == 204) {
    Serial.print("Istek durumu guncellendi: ");
    Serial.println(newStatus);
  } else {
    Serial.print("Guncelleme hatasi! ID: ");
    Serial.print(id);
    Serial.print(" HTTP Kodu: ");
    Serial.println(httpResponseCode);
  }
  
  http.end();
}

// JSON içinden basit string alanı okur. OTA yanıtı sabit ve küçük olduğu için
// ek bir JSON kütüphanesine ihtiyaç duymaz.
String readJsonString(const String& json, const String& key) {
  String marker = "\"" + key + "\":\"";
  int start = json.indexOf(marker);
  if (start < 0) return "";
  start += marker.length();
  int finish = json.indexOf("\"", start);
  if (finish < 0) return "";
  String value = json.substring(start, finish);
  value.replace("\\/", "/");
  value.replace("\\u0026", "&");
  return value;
}

void reportOtaStatus(const String& status, const String& errorMessage) {
  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, String(otaEndpoint) + "/report");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", otaDeviceToken);

  String body = "{\"status\":\"" + status + "\",\"version\":\"" +
                String(firmwareVersion) + "\"";
  if (errorMessage.length() > 0) {
    String safeError = errorMessage;
    safeError.replace("\"", "'");
    body += ",\"error\":\"" + safeError + "\"";
  }
  body += "}";

  http.POST(body);
  http.end();
}

void checkForOtaUpdate() {
  if (String(otaDeviceToken) == "YOUR_OTA_DEVICE_TOKEN") {
    Serial.println("OTA cihaz anahtari ayarlanmamis; kontrol atlandi.");
    return;
  }

  Serial.println("OTA guncellemesi kontrol ediliyor...");

  WiFiClientSecure manifestClient;
  manifestClient.setInsecure();

  HTTPClient http;
  String manifestUrl = String(otaEndpoint) + "/manifest?version=" + firmwareVersion;
  http.begin(manifestClient, manifestUrl);
  http.addHeader("x-device-token", otaDeviceToken);

  int responseCode = http.GET();
  if (responseCode != 200) {
    Serial.printf("OTA manifest hatasi: HTTP %d\n", responseCode);
    http.end();
    return;
  }

  String manifest = http.getString();
  http.end();

  if (manifest.indexOf("\"update\":true") < 0) {
    Serial.println("Firmware guncel.");
    return;
  }

  String newVersion = readJsonString(manifest, "version");
  String downloadUrl = readJsonString(manifest, "url");
  if (newVersion.length() == 0 || downloadUrl.length() == 0) {
    Serial.println("OTA manifest gecersiz.");
    reportOtaStatus("failed", "Manifest gecersiz");
    return;
  }

  Serial.printf("Yeni firmware bulundu: %s -> %s\n", firmwareVersion, newVersion.c_str());
  reportOtaStatus("downloading");

  WiFiClientSecure downloadClient;
  downloadClient.setInsecure();

  HTTPUpdate updater;
  updater.rebootOnUpdate(true);
  updater.onStart([]() {
    Serial.println("OTA kurulumu basladi.");
    reportOtaStatus("installing");
  });
  updater.onProgress([](int current, int total) {
    if (total > 0) Serial.printf("OTA: %d%%\r", (current * 100) / total);
  });
  updater.onError([](int error) {
    Serial.printf("\nOTA hatasi (%d)\n", error);
  });

  t_httpUpdate_return result = updater.update(downloadClient, downloadUrl, firmwareVersion);
  switch (result) {
    case HTTP_UPDATE_FAILED:
      reportOtaStatus("failed", updater.getLastErrorString());
      Serial.printf("OTA basarisiz: %s\n", updater.getLastErrorString().c_str());
      break;
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("OTA: yeni surum yok.");
      break;
    case HTTP_UPDATE_OK:
      // rebootOnUpdate aktif olduğu için cihaz bu noktadan sonra yeniden başlar.
      Serial.println("OTA basarili, cihaz yeniden baslatiliyor.");
      break;
  }
}
