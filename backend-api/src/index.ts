import express from 'express';
import cors from 'cors';
import pvRoutes from './routes/pvRoutes';
import storageRoutes from './routes/storageRoutes';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use('/api', pvRoutes);
app.use('/api/storage', storageRoutes);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});