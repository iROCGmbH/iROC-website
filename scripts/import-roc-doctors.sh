#!/usr/bin/env bash
# Import ROC doctors from roc.de into iROC GmbH Website team members
set -euo pipefail

API="http://localhost:8080/api"
AUTH="Authorization: Bearer $ADMIN_PASSWORD"
TMPDIR=$(mktemp -d)

echo "=== ROC Doctor Import Script ==="
echo "API: $API"
echo ""

# Upload a photo from a URL to object storage, return the objectPath
upload_photo() {
  local src_url="$1"
  local content_type="${2:-image/jpeg}"
  local ext="${src_url##*.}"

  local tmp_file="$TMPDIR/photo.$ext"

  # Download source image
  echo "  Downloading: $src_url"
  if ! curl -s -L -f --max-time 30 -A "Mozilla/5.0" -o "$tmp_file" "$src_url"; then
    echo "  ERROR: Failed to download $src_url"
    return 1
  fi

  local file_size
  file_size=$(wc -c < "$tmp_file")
  echo "  Downloaded: $file_size bytes"

  # Request presigned upload URL
  local req_response
  req_response=$(curl -s -X POST "$API/storage/uploads/request-url" \
    -H "$AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"photo.$ext\",\"size\":$file_size,\"contentType\":\"$content_type\"}")

  local upload_url object_path
  upload_url=$(echo "$req_response" | jq -r '.uploadURL')
  object_path=$(echo "$req_response" | jq -r '.objectPath')

  if [[ "$upload_url" == "null" || -z "$upload_url" ]]; then
    echo "  ERROR: Failed to get presigned URL. Response: $req_response"
    return 1
  fi

  echo "  Uploading to object storage -> $object_path"

  # Upload to GCS via presigned URL
  local put_status
  put_status=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$upload_url" \
    -H "Content-Type: $content_type" \
    --data-binary @"$tmp_file")

  if [[ "$put_status" != "200" ]]; then
    echo "  ERROR: GCS PUT returned $put_status"
    return 1
  fi

  echo "  Uploaded: $object_path"
  echo "$object_path"
}

# PATCH an existing team member (update role/roleDe/bio/bioDe/photoPath)
patch_member() {
  local id="$1"
  local payload="$2"
  local result
  result=$(curl -s -X PATCH "$API/admin/team/$id" \
    -H "$AUTH" \
    -H "Content-Type: application/json" \
    -d "$payload")
  echo "  PATCH /admin/team/$id → $(echo "$result" | jq -r '.id // .error // "?"')"
}

# POST a new team member
create_member() {
  local payload="$1"
  local result
  result=$(curl -s -X POST "$API/admin/team" \
    -H "$AUTH" \
    -H "Content-Type: application/json" \
    -d "$payload")
  echo "  POST /admin/team → id=$(echo "$result" | jq -r '.id // .error // "?"') name=$(echo "$result" | jq -r '.name // "?"')"
}

# --------------------------------------------------------------------------
echo "--- 1. Dr. med. Daniel Filesch (id=6) — upload photo ---"
PATH_FILESCH=$(upload_photo \
  "http://roc.de/wp-content/uploads/2025/03/Dr_Daniel_Filesch_9818_600x600-1.jpg" \
  "image/jpeg")

patch_member 6 "$(jq -n \
  --arg p "$PATH_FILESCH" \
  --arg role "Specialist in Orthopaedics and Trauma Surgery" \
  --arg roleDe "Facharzt für Orthopädie und Unfallchirurgie" \
  --arg bio "Specialist in Orthopaedics and Trauma Surgery, CEO at ROC since 2020. Additional qualifications: Emergency medicine, Manual medicine/chirotherapy, Acupuncture/TCM, ATLS." \
  --arg bioDe "Facharzt für Orthopädie und Unfallchirurgie, CEO im ROC seit 2020. Zusatzbezeichnungen: Notfallmedizin, Manuelle Medizin/Chirotherapie, Akupunktur/TCM, ATLS." \
  '{photoPath:$p, role:$role, roleDe:$roleDe, bio:$bio, bioDe:$bioDe}')"

# --------------------------------------------------------------------------
echo "--- 2. Dr. dr. Orsolya Horváth (id=7) — upload photo ---"
PATH_HORVATH=$(upload_photo \
  "http://roc.de/wp-content/uploads/2023/12/DrHorvath_ROCblog_500x500.jpg" \
  "image/jpeg")

patch_member 7 "$(jq -n \
  --arg p "$PATH_HORVATH" \
  --arg role "Specialist in Dermatology" \
  --arg roleDe "Fachärztin für Dermatologie" \
  --arg bio "Specialist in Dermatology at ROC Derma since November 2023." \
  --arg bioDe "Fachärztin für Dermatologie im ROC Derma seit November 2023." \
  '{photoPath:$p, role:$role, roleDe:$roleDe, bio:$bio, bioDe:$bioDe}')"

# --------------------------------------------------------------------------
echo "--- 3. Martina Berger — new consulting doctor, upload photo ---"
PATH_BERGER=$(upload_photo \
  "http://roc.de/wp-content/uploads/2025/03/Dr_Martina_Berger_5002-600x600-1.jpg" \
  "image/jpeg")

create_member "$(jq -n \
  --arg p "$PATH_BERGER" \
  --arg name "Martina Berger" \
  --arg role "Doctor for Regenerative Orthopaedic Procedures" \
  --arg roleDe "Ärztin für regenerative orthopädische Verfahren" \
  --arg bio "Licensed physician specialising in regenerative orthopaedic procedures at ROC Ortho since 2022. Prior experience in sports traumatology (ZOS Ebersberg), physical and rehabilitation medicine (Medical Park Bad Wiessee), and sports orthopaedics (Klinikum Rechts der Isar). Additional qualifications: Manual medicine/chirotherapy, Acupuncture, Physiotherapy/balneology, Expert for osteoporosis care (DVO), Shockwave therapy." \
  --arg bioDe "Ärztin für regenerative orthopädische Verfahren im ROC Ortho seit 2022. Erfahrung in Sporttraumatologie (ZOS Ebersberg), physikalische und rehabilitative Medizin (Medical Park Bad Wiessee), Sportorthopädie (Klinikum Rechts der Isar). Zusatzbezeichnungen: Manuelle Medizin/Chirotherapie, Akupunktur, Physikalische Therapie/Balneologie, Osteoporoseexpertin (DVO), Stoßwellentherapie." \
  '{photoPath:$p, name:$name, role:$role, roleDe:$roleDe, bio:$bio, bioDe:$bioDe, category:"consulting_doctors", sortOrder:10}')"

# --------------------------------------------------------------------------
echo "--- 4. Dr. med. Ulrich Hölzenbein — new consulting doctor, upload photo ---"
PATH_HOELZ=$(upload_photo \
  "http://roc.de/wp-content/uploads/2025/03/Design-ohne-Titel-1.jpg" \
  "image/jpeg")

create_member "$(jq -n \
  --arg p "$PATH_HOELZ" \
  --arg name "Dr. med. Ulrich Hölzenbein" \
  --arg role "Laboratory Medicine" \
  --arg roleDe "Labormedizin" \
  --arg bio "Specialist in laboratory medicine at ROC." \
  --arg bioDe "Facharzt für Labormedizin im ROC." \
  '{photoPath:$p, name:$name, role:$role, roleDe:$roleDe, bio:$bio, bioDe:$bioDe, category:"consulting_doctors", sortOrder:11}')"

# --------------------------------------------------------------------------
echo "--- 5. Dr. med. Angelika Trey — new consulting doctor, upload photo ---"
PATH_TREY=$(upload_photo \
  "https://roc.de/wp-content/uploads/2026/07/Dr.-med.-Angelika-Trey-819x1024.png" \
  "image/png")

create_member "$(jq -n \
  --arg p "$PATH_TREY" \
  --arg name "Dr. med. Angelika Trey" \
  --arg role "Specialist in Plastic and Aesthetic Surgery" \
  --arg roleDe "Fachärztin für Plastische und Ästhetische Chirurgie" \
  --arg bio "Specialist in plastic and aesthetic surgery with over 10 years of clinical experience. Head of ROC Aesthetic from August 2026. Focus on natural, harmonious results combining surgical precision with individually tailored treatment concepts." \
  --arg bioDe "Fachärztin für Plastische und Ästhetische Chirurgie mit über 10 Jahren klinischer Erfahrung. Leitung ROC Aesthetic ab August 2026. Schwerpunkt auf natürliche, harmonische Ergebnisse durch chirurgische Präzision und individuell abgestimmte Behandlungskonzepte." \
  '{photoPath:$p, name:$name, role:$role, roleDe:$roleDe, bio:$bio, bioDe:$bioDe, category:"consulting_doctors", sortOrder:12}')"

# --------------------------------------------------------------------------
echo "--- 6. Simone Rother — new consulting doctor, upload photo ---"
PATH_ROTHER=$(upload_photo \
  "http://roc.de/wp-content/uploads/2025/03/Simone-Rother_ROC-Vital.jpg" \
  "image/jpeg")

create_member "$(jq -n \
  --arg p "$PATH_ROTHER" \
  --arg name "Simone Rother" \
  --arg role "Physician — Aesthetic, Preventive & Regenerative Medicine" \
  --arg roleDe "Ärztin für Ästhetische, Präventive und Regenerative Medizin" \
  --arg bio "Studied human medicine at LMU Munich. Specialises in minimally invasive and regenerative treatments, skin rejuvenation, health prevention, and metabolic optimisation. Member of GSAAM (German Society of Anti-Aging Medicine). In advanced training in nutritional and orthomolecular medicine." \
  --arg bioDe "Studium der Humanmedizin an der LMU München. Spezialisiert auf minimal-invasive und regenerative Behandlungen, Hautverjüngung, Gesundheitsprävention und Stoffwechseloptimierung. Mitglied der GSAAM. In Weiterbildung Ernährungsmedizin und orthomolekulare Medizin." \
  '{photoPath:$p, name:$name, role:$role, roleDe:$roleDe, bio:$bio, bioDe:$bioDe, category:"consulting_doctors", sortOrder:13}')"

# --------------------------------------------------------------------------
echo "--- 7. Dr. med. Sarah Matz — new consulting doctor, upload photo ---"
PATH_MATZ=$(upload_photo \
  "https://geisenhoferklinik.de/wp-content/uploads/Dr-med-Sarah-Matz.webp" \
  "image/webp")

create_member "$(jq -n \
  --arg p "$PATH_MATZ" \
  --arg name "Dr. med. Sarah Matz" \
  --arg role "Specialist in Gynaecology, Senology & Oncology" \
  --arg roleDe "Fachärztin für Frauenheilkunde, Senologie und gynäkologische Onkologie" \
  --arg bio "Specialist in gynaecology and obstetrics. Head of senology, gynaecological oncology and general gynaecology at ROC gyne and at the certified breast centre of the Geisenhofer Clinic. Performs larger gynaecological surgery at the Geisenhofer Clinic." \
  --arg bioDe "Fachärztin für Frauenheilkunde und Geburtshilfe. Chefärztin für Senologie, gynäkologische Onkologie und allgemeine Gynäkologie im ROC gyne und am zertifizierten Brustzentrum der Frauenklinik Dr. Geisenhofer." \
  '{photoPath:$p, name:$name, role:$role, roleDe:$roleDe, bio:$bio, bioDe:$bioDe, category:"consulting_doctors", sortOrder:14}')"

# --------------------------------------------------------------------------
echo ""
echo "=== Import complete ==="
rm -rf "$TMPDIR"
