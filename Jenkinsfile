pipeline {
    agent { label 'docker' }

    options {
        skipDefaultCheckout(true)
        timestamps()
        disableConcurrentBuilds(abortPrevious: true)
        timeout(time: 60, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '10'))
    }

    environment {
        CI_COMPOSE_FILE = 'docker-compose.ci.yml'
        CI_ENV_FILE = '.env.jenkins-ci'
    }

    stages {
        stage('Checkout') {
            options { timeout(time: 8, unit: 'MINUTES') }
            steps {
                retry(2) {
                    checkout scm
                    sh "git fetch --force --tags origin '+refs/heads/*:refs/remotes/origin/*'"
                }
            }
        }

        stage('Environment Validation') {
            steps {
                sh '''
                    set -eu
                    docker version
                    docker compose version
                    printf 'Commit: %s\n' "$(git rev-parse HEAD)"
                    printf 'Branch: %s\n' "${BRANCH_NAME:-detached}"
                    printf 'Build: %s\n' "${BUILD_NUMBER}"
                    umask 077
                    random_value() { tr -d '-' < /proc/sys/kernel/random/uuid; }
                    project_suffix="$(git rev-parse --short=12 HEAD | tr '[:upper:]' '[:lower:]')"
                    postgres_password="ci-$(random_value)"
                    app_password="ci-$(random_value)"
                    object_access="CI$(random_value | tr '[:lower:]' '[:upper:]')"
                    object_secret="ci-$(random_value)$(random_value)"
                    {
                      printf 'COMPOSE_PROJECT_NAME=relvona-ci-%s-%s-%s\n' "${BUILD_NUMBER}" "${EXECUTOR_NUMBER:-0}" "${project_suffix}"
                      printf 'CI_UID=%s\n' "$(id -u)"
                      printf 'CI_GID=%s\n' "$(id -g)"
                      printf 'POSTGRES_DB=ai_support_db\n'
                      printf 'POSTGRES_USER=postgres\n'
                      printf 'POSTGRES_PASSWORD=%s\n' "${postgres_password}"
                      printf 'DATABASE_ADMIN_URL=postgresql://postgres:%s@postgres:5432/ai_support_db\n' "${postgres_password}"
                      printf 'DATABASE_URL=postgresql://supportai_app:%s@postgres:5432/ai_support_db\n' "${app_password}"
                      printf 'DATABASE_APP_USER=supportai_app\n'
                      printf 'DATABASE_APP_PASSWORD=%s\n' "${app_password}"
                      printf 'BETTER_AUTH_SECRET=%s\n' "$(random_value)$(random_value)"
                      printf 'ENCRYPTION_SECRET_CURRENT=%s\n' "$(random_value)$(random_value)"
                      printf 'WIDGET_SESSION_SECRET=%s\n' "$(random_value)$(random_value)"
                      printf 'VISITOR_IDENTITY_SECRET=%s\n' "$(random_value)$(random_value)"
                      printf 'PORTAL_TOKEN_SECRET=%s\n' "$(random_value)$(random_value)"
                      printf 'METRICS_TOKEN=%s\n' "$(random_value)"
                      printf 'OBJECT_STORAGE_ACCESS_KEY=%s\n' "${object_access}"
                      printf 'OBJECT_STORAGE_SECRET_KEY=%s\n' "${object_secret}"
                      printf 'OBJECT_STORAGE_REGION=us-east-1\n'
                      printf 'NEXT_PUBLIC_API_URL=http://backend:8080/api/v1\n'
                      printf 'INFISICAL_TOKEN=ci-not-used\n'
                      printf 'INFISICAL_PROJECT_ID=ci-not-used\n'
                      printf 'OBJECT_STORAGE_PUBLIC_ENDPOINT=https://objects.invalid\n'
                      printf 'OBJECT_STORAGE_CORS_ALLOWED_ORIGINS=https://frontend.invalid\n'
                    } > "${CI_ENV_FILE}"
                    docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" config --quiet
                    docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps ci sh -lc 'node --version && npm --version && git --version'
                '''
            }
        }

        stage('Install Dependencies') {
            options { timeout(time: 12, unit: 'MINUTES') }
            steps {
                sh '''
                    set -eu
                    docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps ci sh -lc \
                      'npm --prefix backend ci && npm --prefix frontend ci'
                '''
            }
        }

        stage('Quality Checks') {
            parallel {
                stage('Backend Typecheck') {
                    steps {
                        sh 'docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps ci npm --prefix backend run typecheck'
                    }
                }
                stage('Frontend Typecheck') {
                    steps {
                        sh 'docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps ci npm --prefix frontend run typecheck'
                    }
                }
                stage('Frontend Lint') {
                    steps {
                        sh 'docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps -e CHANGE_TARGET="${CHANGE_TARGET:-}" ci npm --prefix frontend run lint:ci'
                    }
                }
                stage('Frontend Format') {
                    steps {
                        sh 'docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps -e CHANGE_TARGET="${CHANGE_TARGET:-}" ci npm --prefix frontend run format:ci'
                    }
                }
            }
        }

        stage('Build') {
            parallel {
                stage('Backend Build') {
                    steps {
                        sh 'docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps ci npm --prefix backend run build'
                    }
                }
                stage('Frontend Build') {
                    steps {
                        sh 'docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps ci npm --prefix frontend run build'
                    }
                }
            }
        }

        stage('Test Infrastructure') {
            options { timeout(time: 12, unit: 'MINUTES') }
            steps {
                sh '''
                    set -eu
                    docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" up -d --wait postgres redis rustfs
                    docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps ci node -e \
                      "let attempts=0; const wait=async()=>{ try { await fetch('http://rustfs:9000'); console.log('RustFS is reachable'); } catch(error) { if (++attempts >= 30) throw error; await new Promise(resolve=>setTimeout(resolve,1000)); return wait(); } }; wait().catch(error=>{ console.error(error); process.exit(1); });"
                    docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm ci sh -lc \
                      'DATABASE_URL="$DATABASE_ADMIN_URL" npm --prefix backend run db:migrate'
                '''
            }
        }

        stage('Tests') {
            stages {
                stage('Unit, AI and Security') {
                    parallel {
                        stage('Unit Tests') {
                            steps {
                                sh 'docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps ci npm --prefix backend run test:ci:unit'
                            }
                        }
                        stage('AI Engine Tests') {
                            options { timeout(time: 12, unit: 'MINUTES') }
                            steps {
                                sh 'docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps ci npm --prefix backend run test:ci:ai'
                            }
                        }
                        stage('Security Tests') {
                            steps {
                                sh '''
                                    docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps ci npm --prefix backend run test:ci:security
                                    docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps ci npm --prefix frontend run test:security
                                    docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps ci npm --prefix frontend run test:security:integration
                                '''
                            }
                        }
                    }
                }
                stage('Integration Tests') {
                    options { timeout(time: 20, unit: 'MINUTES') }
                    steps {
                        sh 'docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps ci npm --prefix backend run test:ci:integration'
                    }
                }
            }
        }

        stage('PipeX Validation') {
            steps {
                sh 'docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps ci npm --prefix backend run test:pipex'
            }
        }

        stage('Orbis Compatibility') {
            steps {
                sh 'docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps ci node backend/scripts/check-orbis-compat.mjs'
            }
        }

        stage('Dependency Audit') {
            parallel {
                stage('Backend Audit') {
                    steps {
                        sh 'docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps ci npm --prefix backend audit --audit-level=high'
                    }
                }
                stage('Frontend Audit') {
                    steps {
                        sh 'docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps ci npm --prefix frontend audit --audit-level=high'
                    }
                }
            }
        }

        stage('Secret Scan') {
            options { timeout(time: 10, unit: 'MINUTES') }
            steps {
                sh '''
                    docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
                      --tmpfs /tmp:rw,noexec,nosuid,size=64m --volume "${PWD}:/repo:ro" \
                      zricethezav/gitleaks@sha256:cdbb7c955abce02001a9f6c9f602fb195b7fadc1e812065883f695d1eeaba854 \
                      detect --source=/repo --config=/repo/.gitleaks.toml --log-opts=--all --redact --no-banner
                '''
            }
        }

        stage('Docker Validation') {
            options { timeout(time: 20, unit: 'MINUTES') }
            steps {
                sh '''
                    set -eu
                    docker compose --env-file "${CI_ENV_FILE}" -f docker-compose.yml config --quiet
                    docker compose --env-file "${CI_ENV_FILE}" -f docker-compose.local.yml config --quiet
                    docker compose --env-file "${CI_ENV_FILE}" -f docker-compose.prod.yml config --quiet
                    docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" up -d --build --wait backend frontend
                    docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" run --rm --no-deps ci node -e \
                      "Promise.all([fetch('http://backend:8080/health/live'), fetch('http://backend:8080/health/ready'), fetch('http://frontend:3000')]).then(rs => { if (rs.some(r => !r.ok)) process.exit(1); console.log('Backend and frontend smoke checks passed'); }).catch(error => { console.error(error); process.exit(1); })"
                '''
            }
        }

        stage('Artifacts') {
            steps {
                sh '''
                    set -eu
                    mkdir -p artifacts
                    tar -czf artifacts/relvona-backend.tgz -C backend dist package.json package-lock.json
                    tar -czf artifacts/relvona-frontend.tgz -C frontend .next/standalone .next/static public package.json package-lock.json
                    docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" images --format json > artifacts/docker-images.json
                    sha256sum artifacts/*.tgz > artifacts/SHA256SUMS
                '''
                archiveArtifacts artifacts: 'artifacts/**', fingerprint: true, onlyIfSuccessful: true
            }
        }
    }

    post {
        always {
            sh '''
                if [ -f "${CI_ENV_FILE}" ]; then
                  docker compose --env-file "${CI_ENV_FILE}" -f "${CI_COMPOSE_FILE}" down --volumes --remove-orphans --rmi local || true
                fi
            '''
            deleteDir()
        }
    }
}
